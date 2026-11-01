import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Execute the real shell script with a fake Docker binary FIRST in PATH.
// No Docker daemon, app, network or database is used.
const script = fileURLToPath(new URL('../../scripts/deploy-local.sh', import.meta.url));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
function run(mode: string) {
  const root = mkdtempSync(join(tmpdir(), 'zlcrm-deploy-test-')), bin = join(root, 'bin'), log = join(root, 'commands.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
set -eu
state="${process.platform === 'win32' ? '$(cygpath -u "$MOCK_ROOT")' : '$MOCK_ROOT'}"
printf '%s\\n' "$*" >> "$state/commands.log"
case "$1" in
  ps) echo fixture-container ;;
  inspect) if [[ "$MOCK_MODE" == legacy ]]; then echo '["sh","-c","npx prisma db push"]'; else echo '["node","dist/app.js"]'; fi ;;
  exec)
    if [[ "$*" == *bot-auto-backfill.cjs* && "$MOCK_MODE" == backfill ]]; then exit 1; fi
    if [[ "$*" == *readiness-probe.cjs* ]]; then
      if [[ "$MOCK_MODE" == unhealthy ]]; then exit 1; fi
      count=0; [[ ! -f "$state/count" ]] || count=$(cat "$state/count")
      count=$((count+1)); echo "$count" > "$state/count"
      [[ "$MOCK_MODE" != delayed || "$count" -ge 2 ]] || exit 1
    fi ;;
esac
`, { mode: 0o755 });
  const shellCommand = process.platform === 'win32'
    ? 'export PATH="$(cygpath -u "$MOCK_BIN"):/usr/bin:/bin"; exec bash "$(cygpath -u "$MOCK_SCRIPT")" --skip-backend --skip-frontend --skip-prisma'
    : 'export PATH="$MOCK_BIN:/usr/bin:/bin"; exec bash "$MOCK_SCRIPT" --skip-backend --skip-frontend --skip-prisma';
  const result = spawnSync(bash, ['-c', shellCommand], {
    env: { ...process.env, MOCK_MODE: mode, MOCK_ROOT: root, MOCK_BIN: bin, MOCK_SCRIPT: script, ZALOCRM_CONTAINER: 'fixture-container', ZALOCRM_READY_ATTEMPTS: '2', ZALOCRM_READY_DELAY_SECONDS: '0' },
    encoding: 'utf8', timeout: 15000,
  });
  if (result.error) throw result.error;
  return { ...result, commands: readFileSync(log, 'utf8') };
}
describe('deployment orchestration using fake Docker', () => {
  it('blocks legacy startup database writes before copying files', () => {
    const r = run('legacy'); expect(r.status).toBe(1); expect(r.stderr).toContain('legacy image');
    expect(r.commands).not.toContain('cp ');
  });
  it('blocks pending grants backfill before replacing application files', () => {
    const r = run('backfill'); expect(r.status).toBe(1);
    expect(r.commands).not.toContain('find /app/dist');
    expect(r.commands).not.toContain('restart');
  });
  it('waits for readiness instead of treating a successful restart as success', () => {
    const r = run('delayed'); expect(r.status).toBe(0);
    expect(r.stdout).toContain('passed readiness');
    expect(r.commands.match(/exec .*readiness-probe.cjs/g)).toHaveLength(2);
  });
  it('fails and restores files when readiness never succeeds', () => {
    const r = run('unhealthy'); expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('passed readiness');
    expect(r.stderr).toContain('Restoring files');
    expect(r.stderr).toContain('ROLLBACK READINESS FAILED');
    expect(r.commands).toContain('cp -a "$1/dist/." /app/dist/');
  });
});
