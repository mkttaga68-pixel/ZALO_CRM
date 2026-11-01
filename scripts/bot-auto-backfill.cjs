// Explicit data migration. --check is read-only; --apply requires a separate
// operator decision and a database backup. Never runs on application startup.
const PENDING_SQL = `SELECT count(*)::int AS count FROM permission_groups pg
 WHERE pg.grants -> 'bot_auto' IS NULL AND EXISTS (
 SELECT 1 FROM jsonb_each(pg.grants) r(resource, actions)
 WHERE r.resource IN ('customer_list','broadcast','sequence','trigger','block')
 AND EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(r.actions)='object' THEN r.actions ELSE '{}'::jsonb END) a(name,val)
 WHERE a.val='true'::jsonb))`;
const UPDATE_SQL = `UPDATE permission_groups SET grants=jsonb_set(grants,'{bot_auto}','{"access":true}'::jsonb,true),updated_at=CURRENT_TIMESTAMP
 WHERE id IN (SELECT pg.id FROM permission_groups pg WHERE pg.grants -> 'bot_auto' IS NULL AND EXISTS (
 SELECT 1 FROM jsonb_each(pg.grants) r(resource,actions)
 WHERE r.resource IN ('customer_list','broadcast','sequence','trigger','block')
 AND EXISTS (SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(r.actions)='object' THEN r.actions ELSE '{}'::jsonb END) a(name,val)
 WHERE a.val='true'::jsonb)))`;

async function checkOrBackfill(client, apply = false) {
  if (!apply) return Number((await client.query(PENDING_SQL)).rows[0].count);
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query('LOCK TABLE permission_groups IN SHARE ROW EXCLUSIVE MODE');
    await client.query(UPDATE_SQL);
    const pending = Number((await client.query(PENDING_SQL)).rows[0].count);
    if (pending !== 0) throw new Error('Backfill verification failed');
    await client.query('COMMIT');
    return pending;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}

module.exports = { checkOrBackfill, PENDING_SQL, UPDATE_SQL };
if (require.main === module) {
  (async () => {
    const apply = process.argv.includes('--apply');
    if (process.argv.slice(2).some(a => !['--apply','--check','--confirm-backup'].includes(a)) ||
        apply && (!process.argv.includes('--confirm-backup') || process.argv.includes('--check'))) throw new Error('Invalid arguments');
    // Works in /app inside Docker and from this repository on Windows.
    const { Client } = require(require.resolve('pg', { paths: [process.cwd(), require('node:path').join(__dirname, '../backend')] }));
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
    if (!process.env.DATABASE_URL) throw new Error('Database target missing');
    try {
      await client.connect();
      const pending = await checkOrBackfill(client, apply);
      if (pending !== 0) {
        console.error('BLOCKED: existing permission groups require explicit Bot-Auto backfill. Review --apply --confirm-backup before deployment.');
        process.exitCode = 1;
      } else console.log('Bot-Auto permission preflight passed');
    } finally { await client.end(); }
  })().catch(() => { console.error('Bot-Auto permission preflight failed; deployment must stop. No credentials logged.'); process.exitCode = 1; });
}
