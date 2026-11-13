// AIQC Nightly Learning — PostgreSQL concurrency suite on a FRESH, DISPOSABLE PostgreSQL 18 cluster.
// Never touches the application/production database (zalo-crm-db / 5433) and never loads dotenv.
// The cluster is created inside the evidence folder, bound to 127.0.0.1 on a free port, and STOPPED
// (not deleted) afterwards so its data stays available as evidence.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), net = require('node:net'), { spawnSync } = require('node:child_process');
const repo = path.resolve(__dirname, '..');
const pgBin = process.env.AIQC_PG_BIN || 'C:\\Program Files\\PostgreSQL\\18\\bin';
const evidenceRoot = path.resolve(repo, '..', 'aiqc-nightly-learning-production-20261112');
const root = path.join(evidenceRoot, 'postgres-' + Date.now().toString(36)), data = path.join(root, 'postgres-data');
const dbName = 'ai_qc_sandbox_learning_pg';
const password = crypto.randomBytes(24).toString('hex');
const baseEnv = {}; for (const k of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATH', 'Path', 'PATHEXT', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']) if (process.env[k]) baseEnv[k] = process.env[k];
Object.assign(baseEnv, { TEMP: root, TMP: root });
function run(exe, args) {
    const fd = fs.openSync(path.join(root, 'pg-control.log'), 'a');
    try { const r = spawnSync(exe, args, { cwd: root, env: baseEnv, windowsHide: true, stdio: ['ignore', fd, fd] }); if (r.error || r.status !== 0) throw Error(path.basename(exe) + ' failed; see pg-control.log'); }
    finally { fs.closeSync(fd); }
}
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
async function main() {
    if (!fs.existsSync(path.join(pgBin, 'initdb.exe'))) throw Error('PostgreSQL 18 binaries unavailable at ' + pgBin);
    if (!root.startsWith(evidenceRoot + path.sep) || fs.existsSync(root)) throw Error('Fresh evidence path required');
    fs.mkdirSync(root, { recursive: true });
    const port = await freePort();
    if (port === 5432 || port === 5433) throw Error('Refusing application database port');
    const pw = path.join(root, 'pw.synthetic'); fs.writeFileSync(pw, password, { flag: 'wx' });
    run(path.join(pgBin, 'initdb.exe'), ['-D', data, '-U', 'ai_qc_sandbox', '--pwfile=' + pw, '-A', 'scram-sha-256', '--encoding=UTF8', '--locale=C']);
    fs.unlinkSync(pw);
    run(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -c max_connections=60`, '-w', 'start']);
    let status = 1;
    try {
        const { Client } = require(path.join(repo, 'backend/node_modules/pg'));
        const admin = new Client({ connectionString: `postgresql://ai_qc_sandbox:${password}@127.0.0.1:${port}/postgres` });
        await admin.connect();
        const id = (await admin.query("SELECT current_setting('data_directory') AS dir, inet_server_port() AS port, version() AS version")).rows[0];
        if (path.resolve(id.dir).toLowerCase() !== data.toLowerCase() || Number(id.port) !== port) throw Error('Cluster identity mismatch');
        await admin.query(`CREATE DATABASE "${dbName}"`); await admin.end();
        const url = `postgresql://ai_qc_sandbox:${password}@127.0.0.1:${port}/${dbName}`;
        const c = new Client({ connectionString: url }); await c.connect();
        for (const m of ['20261101120000_native_ai_quality_control'])
            await c.query(fs.readFileSync(path.join(repo, 'backend/prisma/migrations', m, 'migration.sql'), 'utf8'));
        await c.end();
        fs.writeFileSync(path.join(root, 'cluster-identity.json'), JSON.stringify({ dataDirectory: data, port, host: '127.0.0.1', database: dbName, server: id.version, applicationDatabaseTouched: false, createdAt: new Date().toISOString() }, null, 2));
        const env = { ...baseEnv, NODE_ENV: 'test', TZ: 'UTC', QC_TEST_ROOT: root, AI_QC_ENABLED: 'true', AI_QC_REAL_API_ENABLED: 'false', AI_QC_REAL_DATA_ENABLED: 'false',
            AI_QC_OUTBOUND_TEST_APPROVED: 'false', AI_QC_REAL_DATA_OUTBOUND_APPROVED: 'false', AIQC_LEARNING_PG_URL: url, AIQC_LEARNING_PG_DB: dbName };
        const r = spawnSync(process.execPath, [path.join(repo, 'backend/node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.aiqc-learning-postgres.config.ts'], { cwd: path.join(repo, 'backend'), env, stdio: 'inherit' });
        status = r.status ?? 1;
    } finally {
        try { run(path.join(pgBin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop']); } catch (e) { console.error(e.message); }
        fs.writeFileSync(path.join(root, 'stopped.json'), JSON.stringify({ at: new Date().toISOString(), dataDeleted: false, applicationDatabaseTouched: false }, null, 2));
    }
    console.log('Evidence: ' + root);
    process.exitCode = status;
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
