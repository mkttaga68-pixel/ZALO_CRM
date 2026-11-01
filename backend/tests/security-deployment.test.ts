import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { checkOrBackfill, UPDATE_SQL } = require('../../scripts/bot-auto-backfill.cjs');
const { isReady } = require('../../scripts/readiness-probe.cjs');

describe('deployment readiness', () => {
  it('requires HTTP success AND connected database', async () => {
    for (const [ok, body, expected] of [
      [true, { status: 'ok', db: 'connected' }, true],
      [true, { status: 'error', db: 'disconnected' }, false],
      [false, { status: 'ok', db: 'connected' }, false],
    ] as const) {
      expect(await isReady(vi.fn().mockResolvedValue({ ok, json: async () => body }), 3000)).toBe(expected);
    }
  });
  it('rejects timeout, redirect and invalid JSON responses', async () => {
    const failed = vi.fn().mockRejectedValue(new Error('fixture connection failed'));
    expect(await isReady(failed, 3000)).toBe(false);
    expect(await isReady(vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error('invalid'); } }), 3000)).toBe(false);
    expect(await isReady(failed, 'bad-port')).toBe(false);
  });
  it('does not mutate grants during deployment preflight', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: 3 }] });
    expect(await checkOrBackfill({ query })).toBe(3);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/^SELECT/);
  });
  it('applies explicit backfill in a locked transaction and verifies it', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: 0 }] });
    expect(await checkOrBackfill({ query }, true)).toBe(0);
    expect(query.mock.calls[0][0]).toBe('BEGIN');
    expect(query.mock.calls.some(([sql]) => sql.startsWith('LOCK TABLE'))).toBe(true);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(UPDATE_SQL).toContain("pg.grants -> 'bot_auto' IS NULL");
  });
  it('rolls back an incomplete backfill', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ count: 1 }] });
    await expect(checkOrBackfill({ query }, true)).rejects.toThrow('verification failed');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });
  it('never runs database mutation from Docker startup', () => {
    const dockerfile = readFileSync(new URL('../../docker/Dockerfile', import.meta.url), 'utf8');
    expect(dockerfile).not.toMatch(/^(CMD|ENTRYPOINT).*prisma.*(db push|migrate|db execute)/m);
    expect(dockerfile).toContain('HEALTHCHECK');
  });
});
