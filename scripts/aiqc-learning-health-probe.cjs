// AIQC Nightly Learning — monitoring probe (read-only).
// Calls GET /api/v1/ai-quality-control/learning-drafts/health with an Admin (approve + view_all) token and
// prints a content-free summary. Exit codes: 0 = OK, 1 = alerts present, 2 = probe/HTTP failure.
// Usage (operator):  AIQC_BASE_URL=http://127.0.0.1:3080 AIQC_HEALTH_TOKEN_FILE=<file with JWT> node scripts/aiqc-learning-health-probe.cjs [--expect-scheduler]
// The token is read from a file (never from argv) and never printed. No data is changed.
const fs = require('node:fs');
(async () => {
    const base = process.env.AIQC_BASE_URL, file = process.env.AIQC_HEALTH_TOKEN_FILE;
    if (!base || !file) { console.error('Set AIQC_BASE_URL and AIQC_HEALTH_TOKEN_FILE'); process.exit(2); }
    const token = fs.readFileSync(file, 'utf8').trim();
    let r;
    try { r = await fetch(new URL('/api/v1/ai-quality-control/learning-drafts/health', base), { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) }); }
    catch (e) { console.error(JSON.stringify({ status: 'PROBE_FAILED', error: e.name })); process.exit(2); }
    const body = await r.json().catch(() => null);
    if (r.status !== 200 || !body) { console.error(JSON.stringify({ status: 'HTTP_' + r.status, error: body?.error ?? null })); process.exit(2); }
    const alerts = [...body.alerts];
    if (process.argv.includes('--expect-scheduler') && !body.scheduler.allowed) alerts.push('SCHEDULER_NOT_RUNNING');
    console.log(JSON.stringify({ status: alerts.length ? 'ALERT' : 'OK', alerts, scheduler: body.scheduler, lastJob: body.lastJob, drafts: body.drafts, outbox: body.outbox, realtime: body.realtime, storageMode: body.storageMode }, null, 2));
    process.exit(alerts.length ? 1 : 0);
})();
