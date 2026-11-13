// Feature-only migration for the existing CRM database. Never loaded on startup.
// No dotenv and no execution of other pending Prisma migrations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const migration='20261101120000_native_ai_quality_control',table='native_ai_qc_workspace';
const fail=code=>{const error=Error(code);error.releaseCode=code;throw error;};
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
function artifact(){
  const root=path.resolve(__dirname,'..'),base=fs.existsSync(path.join(root,'backend/prisma/migrations'))?path.join(root,'backend/prisma/migrations'):path.join(root,'prisma/migrations');
  const dir=path.join(base,migration),sql=fs.readFileSync(path.join(dir,'migration.sql'),'utf8'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'migration.manifest.json'),'utf8'));
  const ddl=sql.replace(/--[^\r\n]*/g,'').trim();
  if(manifest.migration!==migration||manifest.sha256!==sha(Buffer.from(sql))||JSON.stringify(manifest.tables)!==JSON.stringify([table])||!/^CREATE TABLE "native_ai_qc_workspace" \([\s\S]+\);$/.test(ddl)||ddl.slice(0,-1).includes(';'))fail('MIGRATION_ARTIFACT_MISMATCH');
  return {sql,manifest};
}
async function verify(client){
  const columns=(await client.query(`SELECT a.attname AS name,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default_expr FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.native_ai_qc_workspace'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
  const expected={organization_id:'text',version:'integer',payload:'jsonb',updated_at:'timestamp(3) with time zone'};
  if(columns.length!==4||columns.some(c=>expected[c.name]!==c.type||!c.required))fail('NATIVE_QC_COLUMN_DRIFT');
  if(!/^\(?0\)?(?:::integer)?$/.test(columns.find(c=>c.name==='version').default_expr||'')||!/^CURRENT_TIMESTAMP$/i.test(columns.find(c=>c.name==='updated_at').default_expr||'')||columns.filter(c=>['organization_id','payload'].includes(c.name)).some(c=>c.default_expr!==null))fail('NATIVE_QC_DEFAULT_DRIFT');
  // PG18 exposes NOT NULL entries in pg_constraint; requiredness was verified
  // through pg_attribute above, which also supports the existing PG16 deployment.
  const constraints=(await client.query(`SELECT c.contype,c.convalidated,pg_get_constraintdef(c.oid) AS definition,(SELECT array_agg(a.attname::text ORDER BY k.n) FROM unnest(c.conkey) WITH ORDINALITY k(num,n) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num) AS columns FROM pg_constraint c WHERE c.conrelid='public.native_ai_qc_workspace'::regclass AND c.contype<>'n'`)).rows;
  const normalize=value=>value.replace(/[()\s"]/g,'').toLowerCase(),checks=constraints.filter(c=>c.contype==='c');
  if(constraints.length!==3||constraints.some(c=>!c.convalidated)||!constraints.some(c=>c.contype==='p'&&JSON.stringify(c.columns)==='["organization_id"]')||checks.length!==2||!checks.some(c=>normalize(c.definition)==='checkversion>=0')||!checks.some(c=>normalize(c.definition)==="checkjsonb_typeofpayload='object'::text"))fail('NATIVE_QC_CONSTRAINT_DRIFT');
  const indexes=(await client.query(`SELECT indisvalid,indisready,indisunique,indisprimary,indpred IS NULL AS unconditional FROM pg_index WHERE indrelid='public.native_ai_qc_workspace'::regclass`)).rows;
  if(indexes.length!==1||indexes.some(i=>!i.indisvalid||!i.indisready||!i.indisunique||!i.indisprimary||!i.unconditional))fail('NATIVE_QC_INDEX_DRIFT');
  const policy=(await client.query(`SELECT relkind,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='public.native_ai_qc_workspace'::regclass`)).rows[0];
  if(policy.relkind!=='r'||policy.relrowsecurity||policy.relforcerowsecurity)fail('NATIVE_QC_POLICY_DRIFT');
  if((await client.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='public.native_ai_qc_workspace'::regclass AND NOT tgisinternal`)).rows.length)fail('NATIVE_QC_TRIGGER_DRIFT');
}
async function history(client,checksum){
  if(!(await client.query("SELECT to_regclass('public._prisma_migrations') AS name")).rows[0].name)return false;
  const rows=(await client.query('SELECT checksum,finished_at,rolled_back_at FROM public._prisma_migrations WHERE migration_name=$1',[migration])).rows;
  if(rows.some(r=>!r.rolled_back_at&&(!r.finished_at||r.checksum!==checksum))||rows.filter(r=>r.finished_at&&!r.rolled_back_at).length>1)fail('NATIVE_QC_MIGRATION_HISTORY_DRIFT');
  return rows.some(r=>r.finished_at&&!r.rolled_back_at);
}
async function record(client,checksum){
  await client.query(`CREATE TABLE IF NOT EXISTS public._prisma_migrations (id VARCHAR(36) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,finished_at TIMESTAMPTZ,migration_name VARCHAR(255) NOT NULL,logs TEXT,rolled_back_at TIMESTAMPTZ,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
  await client.query(`INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES($1,$2,clock_timestamp(),$3,1)`,[crypto.randomUUID(),checksum,migration]);
}
async function main(){
  const args=process.argv.slice(2),flags=new Set(),values={},allowed=new Set(['--artifact-check','--check','--apply','--adopt-existing','--backup-file','--backup-sha256','--expected-database']);
  for(let i=0;i<args.length;i++){const flag=args[i];if(!allowed.has(flag)||flags.has(flag))fail('INVALID_ARGUMENTS');flags.add(flag);if(['--backup-file','--backup-sha256','--expected-database'].includes(flag)){if(!args[i+1]||args[i+1].startsWith('--'))fail('INVALID_ARGUMENTS');values[flag]=args[++i];}}
  const release=artifact();if(flags.has('--artifact-check')){if(args.length!==1)fail('INVALID_ARGUMENTS');console.log(JSON.stringify({status:'ARTIFACT_VERIFIED',migration,sha256:release.manifest.sha256,databaseConnected:false}));return;}
  const apply=flags.has('--apply');if(!apply&&args.some(a=>a!=='--check')||apply&&flags.has('--check'))fail('INVALID_ARGUMENTS');
  let backupSha256;
  if(apply){
    if(!values['--expected-database']||!values['--backup-file']||!/^[a-f0-9]{64}$/.test(values['--backup-sha256']||''))fail('TARGET_AND_VERIFIED_BACKUP_REQUIRED');
    const file=values['--backup-file'],header=Buffer.alloc(5),fd=fs.openSync(file,'r');try{fs.readSync(fd,header,0,5,0);}finally{fs.closeSync(fd);}
    if(fs.statSync(file).size<64||header.toString()!=='PGDMP')fail('BACKUP_VERIFICATION_FAILED');
    const hash=crypto.createHash('sha256');for await(const part of fs.createReadStream(file))hash.update(part);backupSha256=hash.digest('hex');if(backupSha256!==values['--backup-sha256'])fail('BACKUP_VERIFICATION_FAILED');
  }
  if(!process.env.DATABASE_URL)fail('DATABASE_URL_REQUIRED');const target=new URL(process.env.DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(target.protocol)||target.searchParams.get('schema')&&target.searchParams.get('schema')!=='public')fail('DATABASE_TARGET_UNSUPPORTED');
  const name=decodeURIComponent(target.pathname.slice(1));if(apply&&name!==values['--expected-database'])fail('DATABASE_TARGET_MISMATCH');
  const {Client}=require(require.resolve('pg',{paths:[process.cwd(),path.resolve(__dirname,'../backend'),path.resolve(__dirname,'..')]}));
  const client=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:30000,application_name:'native-ai-qc-feature-release'});let transaction=false;
  try{
    await client.connect();const identity=await client.query('SELECT current_database() AS name');if(identity.rows[0]?.name!==name)fail('DATABASE_IDENTITY_MISMATCH');
    await client.query(apply?'BEGIN':'BEGIN READ ONLY');transaction=true;await client.query("SET LOCAL lock_timeout='5s'");await client.query('SET LOCAL search_path=public');
    if(apply)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[migration]);
    const tracked=await history(client,release.manifest.sha256),exists=!!(await client.query("SELECT to_regclass('public.native_ai_qc_workspace') AS name")).rows[0].name;
    if(tracked&&!exists)fail('TRACKED_NATIVE_QC_TABLE_MISSING');
    if(exists){if(apply)await client.query('LOCK TABLE public.native_ai_qc_workspace IN SHARE ROW EXCLUSIVE MODE');await verify(client);}
    if(!apply){await client.query('COMMIT');transaction=false;console.log(JSON.stringify({status:tracked?'UP_TO_DATE':exists?'UNTRACKED_REQUIRES_ADOPTION':'PENDING_NEW_TABLE',migration,readOnly:true}));process.exitCode=tracked?0:2;return;}
    if(!tracked){if(exists&&!flags.has('--adopt-existing'))fail('EXPLICIT_ADOPTION_REQUIRED');if(!exists){await client.query(release.sql);await verify(client);}await record(client,release.manifest.sha256);}
    await client.query('COMMIT');transaction=false;console.log(JSON.stringify({status:tracked?'ALREADY_APPLIED':exists?'ADOPTED_VERIFIED_EXISTING':'APPLIED',migration,sha256:release.manifest.sha256,backupSha256,otherMigrationsExecuted:0}));
  }finally{if(transaction)await client.query('ROLLBACK').catch(()=>{});await client.end().catch(()=>{});}
}
if(require.main===module)main().catch(error=>{console.error(JSON.stringify({status:'BLOCKED',code:error.releaseCode||'DATABASE_OR_FILESYSTEM_ERROR',databaseCode:/^[A-Z0-9]{5}$/.test(String(error.code))?error.code:undefined}));process.exitCode=1;});
module.exports={artifact,verify};
