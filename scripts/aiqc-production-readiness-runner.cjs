// AIQC Nightly Learning — production-readiness QA runner (synthetic only).
// Never loads dotenv, never inherits secrets, never connects to the application/production database.
// Usage: node scripts/aiqc-production-readiness-runner.cjs <label> [task,task,...]
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const root = path.resolve(repo, '..', 'aiqc-nightly-learning-production-20261112');
const label = process.argv[2] || 'run';
if (!/^[a-z0-9-]+$/.test(label)) throw Error('Invalid label');
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;
const vitest = path.join(repo, 'backend/node_modules/vitest/vitest.mjs');
const node = process.execPath;
const tasks = [
    ['learning-backend', 'backend', [vitest, 'run', '--config', 'vitest.aiqc-learning.config.ts']],
    ['customer-archive-backend', 'backend', [vitest, 'run', '--config', 'vitest.customer-archive.config.ts']],
    ['learning-frontend', 'frontend', [vitest, 'run', '--config', 'vitest.aiqc-learning.config.mjs']],
    ['native-backend', 'backend', [vitest, 'run', '--config', 'vitest.native-ai-qc.config.ts']],
    ['native-frontend', 'frontend', [vitest, 'run', '--config', 'vitest.native-ai-qc.config.mjs']],
    ['monitoring-backend', 'backend', [vitest, 'run', '--config', 'vitest.native-ai-qc-monitoring.config.ts']],
    ['monitoring-frontend', 'frontend', [vitest, 'run', '--config', 'vitest.native-ai-qc-monitoring.config.mjs']],
    ['openai-control-backend', 'backend', [vitest, 'run', '--config', 'vitest.openai-control.config.ts']],
    ['manual-real-frontend', 'frontend', [vitest, 'run', '--config', 'vitest.manual-real.config.mjs']],
    ['rbac-frontend', 'frontend', [vitest, 'run', '--config', 'vitest.rbac.config.mjs']],
    ['backend-all', 'backend', [vitest, 'run', '--config', 'vitest.config.ts', '--reporter=default', '--reporter=json', '--outputFile.json=__OUT__/results.json']],
    ['backend-typecheck', 'backend', [path.join(repo, 'backend/node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json']],
    ['frontend-typecheck', 'frontend', [path.join(repo, 'frontend/node_modules/vue-tsc/bin/vue-tsc.js'), '-b']],
    ['frontend-build', 'frontend', [path.join(repo, 'frontend/node_modules/vite/bin/vite.js'), 'build', '--outDir', '__OUT__/dist', '--emptyOutDir']],
];
const results = [];
for (const [name, cwd, args0] of tasks) {
    if (only && !only.has(name)) continue;
    const out = path.join(root, label, name); fs.mkdirSync(out, { recursive: true });
    const env = {};
    for (const k of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATH', 'Path', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'])
        if (process.env[k]) env[k] = process.env[k];
    Object.assign(env, { NODE_ENV: 'test', TZ: 'UTC', TEMP: out, TMP: out, QC_TEST_ROOT: out, AI_QC_ENABLED: 'true', AI_QC_REAL_API_ENABLED: 'false', AI_QC_REAL_DATA_ENABLED: 'false',
        AI_QC_OUTBOUND_TEST_APPROVED: 'false', AI_QC_REAL_DATA_OUTBOUND_APPROVED: 'false', DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/ai_qc_sandbox_never_connect' });
    if (name.endsWith('build')) env.NODE_ENV = 'production';
    const args = args0.map(a => a.replace('__OUT__', out.replace(/\\/g, '/')));
    const started = Date.now();
    const r = cp.spawnSync(node, args, { cwd: path.join(repo, cwd), env, encoding: 'utf8', windowsHide: true, timeout: 900000, maxBuffer: 256 * 1024 * 1024 });
    fs.writeFileSync(path.join(out, 'output.log'), (r.stdout || '') + (r.stderr || ''));
    const files = fs.readdirSync(out).filter(f => f.endsWith('results.json'));
    let json = {}; try { json = files[0] ? JSON.parse(fs.readFileSync(path.join(out, files[0]), 'utf8')) : {}; } catch { }
    const failedNames = (json.testResults || []).flatMap(t => (t.assertionResults || []).filter(a => a.status === 'failed').map(a => path.basename(t.name) + ' :: ' + a.fullName));
    results.push({ name, exit: r.status, ms: Date.now() - started, passed: json.numPassedTests, failed: json.numFailedTests, total: json.numTotalTests, failedNames: failedNames.slice(0, 60), error: r.error?.message });
    console.log(JSON.stringify({ ...results.at(-1), failedNames: failedNames.length }));
}
fs.writeFileSync(path.join(root, label + '-results.json'), JSON.stringify(results, null, 2));
if (results.some(r => r.exit !== 0)) process.exitCode = 1;
