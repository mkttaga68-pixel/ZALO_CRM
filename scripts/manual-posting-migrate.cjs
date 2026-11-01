// Explicit, feature-only release. Never invoke on application startup.
// Uses DATABASE_URL provided by operator; deliberately does not load .env files.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const migrationName = '20261031180000_manual_posting';
const fail = code => { const error = new Error(code); error.releaseCode = code; throw error; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const tables = ['manual_posting_jobs', 'manual_posting_recipients'];
const required = {
  manual_posting_jobs: {
    id: 'text', org_id: 'text', created_by_id: 'text', zalo_account_id: 'text', request_id: 'text',
    fingerprint: 'text', kind: 'text', body: 'text', image_urls: 'jsonb', delay_seconds: 'integer', status: 'text',
    worker_id: 'text?', lease_until: 'timestamp(3) with time zone?', last_error: 'text?',
    created_at: 'timestamp(3) with time zone', updated_at: 'timestamp(3) with time zone',
  },
  manual_posting_recipients: {
    id: 'text', org_id: 'text', job_id: 'text', target_ref: 'text', thread_id: 'text', display_name: 'text',
    ordinal: 'integer', status: 'text', error: 'text?', started_at: 'timestamp(3) with time zone?', sent_at: 'timestamp(3) with time zone?',
  },
};
const defaults = {
  manual_posting_jobs: { image_urls: "'[]'::jsonb", delay_seconds: '10', status: "'QUEUED'::text", created_at: 'CURRENT_TIMESTAMP', updated_at: 'CURRENT_TIMESTAMP' },
  manual_posting_recipients: { status: "'QUEUED'::text" },
};
const checks = {
  manual_posting_jobs: [
    "kind=ANY['GROUP','OFFER']", "jsonb_typeofimage_urls='array'", 'delay_seconds>=10ANDdelay_seconds<=300',
    "status=ANY['QUEUED','RUNNING','DONE','PARTIAL','FAILED','UNKNOWN','CANCELLED']",
  ],
  manual_posting_recipients: ["status=ANY['QUEUED','SENDING','SENT','FAILED','UNKNOWN','SKIPPED']"],
};
function normalizeCheck(value) {
  return value.replace(/^CHECK\s*/i, '').replace(/::text/g, '').replace(/ARRAY/g, '').replace(/[\s()]/g, '');
}
function artifact() {
  const prismaDir = [path.resolve(__dirname, '../backend/prisma'), path.resolve(__dirname, '../prisma')]
    .find(p => fs.existsSync(path.join(p, 'manual-posting-release.json')));
  if (!prismaDir) fail('RELEASE_MANIFEST_MISSING');
  const manifest = JSON.parse(fs.readFileSync(path.join(prismaDir, 'manual-posting-release.json'), 'utf8'));
  if (manifest.migration !== migrationName || manifest.schema !== 'public') fail('RELEASE_MANIFEST_INVALID');
  const bytes = fs.readFileSync(path.join(prismaDir, 'migrations', migrationName, 'migration.sql'));
  if (sha(bytes) !== manifest.sha256) fail('MIGRATION_CHECKSUM_MISMATCH');
  return { manifest, sql: bytes.toString('utf8') };
}
async function existingTables(client) {
  return (await client.query("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[]) ORDER BY tablename", [tables])).rows.map(r => r.tablename);
}
async function history(client, checksum) {
  const exists = (await client.query("SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present")).rows[0].present;
  if (!exists) return false;
  const rows = (await client.query('SELECT checksum,finished_at FROM public._prisma_migrations WHERE migration_name=$1 AND rolled_back_at IS NULL', [migrationName])).rows;
  if (rows.length > 1) fail('DUPLICATE_MIGRATION_HISTORY');
  if (!rows.length) return false;
  if (!rows[0].finished_at) fail('UNFINISHED_MIGRATION_HISTORY');
  if (rows[0].checksum !== checksum) fail('HISTORY_CHECKSUM_MISMATCH');
  return true;
}
async function verifyTable(client, table) {
  const columns = (await client.query(`SELECT a.attname AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) AS def FROM pg_catalog.pg_attribute a
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=$1::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, ['public.'+table])).rows;
  if (columns.length !== Object.keys(required[table]).length) fail('COLUMN_COUNT_DRIFT');
  for (const col of columns) {
    const expected = required[table][col.name];
    if (!expected || col.type !== expected.replace(/\?$/, '') || col.required !== !expected.endsWith('?')) fail('COLUMN_TYPE_OR_NULLABILITY_DRIFT');
    const want = defaults[table][col.name] ?? null;
    if (col.def !== want && !(want === 'CURRENT_TIMESTAMP' && col.def === 'now()')) fail('COLUMN_DEFAULT_DRIFT');
  }
  const constraints = (await client.query(`SELECT c.contype,c.convalidated,c.confdeltype,c.confupdtype,
    pg_catalog.pg_get_constraintdef(c.oid,true) AS definition,
    (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(num,n) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num) AS columns,
    CASE WHEN c.confrelid<>0 THEN c.confrelid::regclass::text ELSE NULL END AS target,
    (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(c.confkey) WITH ORDINALITY k(num,n) JOIN pg_catalog.pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num) AS target_columns
    FROM pg_catalog.pg_constraint c WHERE c.conrelid=$1::regclass`, ['public.'+table])).rows;
  const key = cols => (cols || []).join(',');
  if (!constraints.some(c => c.contype === 'p' && key(c.columns) === 'id')) fail('PRIMARY_KEY_DRIFT');
  const uniques = constraints.filter(c => c.contype === 'u').map(c => key(c.columns)).sort();
  const wantedUnique = table === tables[0] ? ['org_id,id','org_id,created_by_id,request_id'].sort() : ['org_id,job_id,thread_id'];
  if (JSON.stringify(uniques) !== JSON.stringify(wantedUnique)) fail('UNIQUE_CONSTRAINT_DRIFT');
  const actualChecks = constraints.filter(c => c.contype === 'c');
  if (actualChecks.length !== checks[table].length || actualChecks.some(c => !c.convalidated || !checks[table].includes(normalizeCheck(c.definition)))) fail('CHECK_CONSTRAINT_DRIFT');
  const fks = constraints.filter(c => c.contype === 'f');
  if (table === tables[0] ? fks.length !== 0 : fks.length !== 1 || !fks.some(c => c.convalidated && key(c.columns) === 'org_id,job_id' &&
    ['manual_posting_jobs','public.manual_posting_jobs'].includes(c.target) && key(c.target_columns) === 'org_id,id' && c.confdeltype === 'c' && c.confupdtype === 'a')) fail('TENANT_FOREIGN_KEY_DRIFT');
  const indexes = (await client.query(`SELECT i.indisvalid,i.indisready,i.indisunique,i.indpred IS NULL AS unconditional,
    pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
    (SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(i.indkey) WITH ORDINALITY k(num,n) LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num) AS columns
    FROM pg_catalog.pg_index i WHERE i.indrelid=$1::regclass`, ['public.'+table])).rows;
  if (indexes.some(i => !i.indisvalid || !i.indisready)) fail('INDEX_NOT_READY');
  const wantedIndexes = table === tables[0] ? ['org_id,created_at','status,created_at','zalo_account_id,status'] : ['org_id,job_id,ordinal'];
  for (const wanted of wantedIndexes) if (!indexes.some(i => i.unconditional && !i.indisunique && key(i.columns) === wanted &&
    /USING btree/.test(i.definition) && (wanted !== 'org_id,created_at' || /created_at DESC/.test(i.definition)))) fail('REQUIRED_INDEX_DRIFT');
  const allowedUnique = ['id', ...wantedUnique];
  if (indexes.some(i => i.indisunique && (!i.unconditional || !allowedUnique.includes(key(i.columns))))) fail('UNEXPECTED_UNIQUE_INDEX');
  const options = (await client.query('SELECT relrowsecurity,relforcerowsecurity,relkind FROM pg_catalog.pg_class WHERE oid=$1::regclass', ['public.'+table])).rows[0];
  if (options.relkind !== 'r' || options.relrowsecurity || options.relforcerowsecurity) fail('UNREVIEWED_TABLE_POLICY');
}
async function verify(client) { for (const table of tables) await verifyTable(client, table); }
async function record(client, checksum) {
  // Create standard Prisma history only when explicitly applying this feature.
  // Never mark any unrelated migration as applied.
  await client.query(`CREATE TABLE IF NOT EXISTS public._prisma_migrations (
    id VARCHAR(36) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,finished_at TIMESTAMPTZ,
    migration_name VARCHAR(255) NOT NULL,logs TEXT,rolled_back_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
  await client.query(`INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count)
    VALUES($1,$2,clock_timestamp(),$3,1)`, [randomUUID(),checksum,migrationName]);
}
async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(['--check','--apply','--adopt-existing','--backup-file','--backup-sha256','--artifact-check','--help']);
  const flags = new Set(); const values = {};
  for(let i=0;i<args.length;i++) {
    const flag=args[i]; if(!allowed.has(flag)||flags.has(flag)) fail('INVALID_ARGUMENTS'); flags.add(flag);
    if(['--backup-file','--backup-sha256'].includes(flag)) { if(!args[i+1]||args[i+1].startsWith('--'))fail('INVALID_ARGUMENTS'); values[flag]=args[++i]; }
  }
  if(flags.has('--help')) { console.log('node scripts/manual-posting-migrate.cjs [--artifact-check | --check | --apply --backup-file PATH --backup-sha256 SHA256 [--adopt-existing]]'); return; }
  const release = artifact();
  if(flags.has('--artifact-check')) { if(args.length!==1)fail('INVALID_ARGUMENTS'); console.log(JSON.stringify({status:'ARTIFACT_VERIFIED',migration:migrationName,sha256:release.manifest.sha256,databaseConnected:false}));return; }
  const apply = flags.has('--apply');
  if(apply && flags.has('--check') || !apply && [...flags].some(f => f!=='--check')) fail('INVALID_ARGUMENTS');
  let backupSha256;
  if(apply) {
    if(!values['--backup-file']||!/^[a-f0-9]{64}$/.test(values['--backup-sha256']||''))fail('VERIFIED_BACKUP_REQUIRED');
    const file=values['--backup-file'],header=Buffer.alloc(5),fd=fs.openSync(file,'r');
    try { fs.readSync(fd,header,0,5,0); } finally { fs.closeSync(fd); }
    if(fs.statSync(file).size<64||header.toString()!=='PGDMP')fail('BACKUP_VERIFICATION_FAILED');
    const digest=createHash('sha256'); for await(const chunk of fs.createReadStream(file))digest.update(chunk);
    backupSha256=digest.digest('hex');
    if(backupSha256!==values['--backup-sha256'])fail('BACKUP_VERIFICATION_FAILED');
  }
  if(!process.env.DATABASE_URL)fail('DATABASE_URL_REQUIRED');
  const {Client} = require(require.resolve('pg',{paths:[process.cwd(),path.resolve(__dirname,'../backend'),path.resolve(__dirname,'..')]}));
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000,application_name:'manual-posting-release'});
  let transaction=false;
  try {
    await client.connect(); await client.query(apply?'BEGIN':'BEGIN READ ONLY');transaction=true;
    await client.query("SET LOCAL lock_timeout='5s'"); await client.query("SET LOCAL search_path=public");
    if(apply) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[migrationName]);
    const tracked=await history(client,release.manifest.sha256);
    const existing=await existingTables(client);
    if(existing.length===1)fail('PARTIAL_SCHEMA_STOP');
    if(tracked && !existing.length)fail('TRACKED_BUT_TABLES_MISSING');
    if(existing.length) {
      if(apply)await client.query('LOCK TABLE public.manual_posting_jobs,public.manual_posting_recipients IN SHARE ROW EXCLUSIVE MODE');
      await verify(client);
    }
    if(!apply) {
      await client.query('COMMIT');transaction=false;
      const status=tracked?'UP_TO_DATE':existing.length?'UNTRACKED_EXISTING_REQUIRES_ADOPTION':'PENDING_NEW_TABLES';
      console.log(JSON.stringify({status,migration:migrationName,readOnly:true,tables:existing}));process.exitCode=tracked?0:2;return;
    }
    if(!tracked) {
      if(existing.length && !flags.has('--adopt-existing'))fail('EXPLICIT_ADOPTION_REQUIRED');
      if(!existing.length) { await client.query(release.sql); await verify(client); }
      await record(client,release.manifest.sha256);
    }
    await client.query('COMMIT');transaction=false;
    console.log(JSON.stringify({status:tracked?'ALREADY_APPLIED':existing.length?'ADOPTED_VERIFIED_EXISTING':'APPLIED',migration:migrationName,sha256:release.manifest.sha256,backupSha256,otherMigrationsExecuted:0}));
  } finally { if(transaction) await client.query('ROLLBACK').catch(()=>{}); await client.end().catch(()=>{}); }
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({status:'BLOCKED',code:error.releaseCode||'DATABASE_OR_FILESYSTEM_ERROR',databaseCode:/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:undefined}));process.exitCode=1;});
