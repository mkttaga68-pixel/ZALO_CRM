// Live release-runner checks ONLY in a new database on the proven synthetic cluster.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),parent=path.resolve(repo,'..','native-ai-qc-runtime'),out=path.resolve(repo,'..','native-ai-qc-shared-backend-evidence-20261101');
async function main(){
  const root=path.resolve(JSON.parse(fs.readFileSync(path.join(parent,'latest.json'),'utf8')).root);if(!root.startsWith(parent+path.sep))throw Error('Invalid sandbox');
  const state=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));if(!state.syntheticOnly||state.ports.database!==59941)throw Error('Not a synthetic database service');
  const password=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');if(!/^[a-f0-9]{48}$/.test(password))throw Error('Invalid generated credential');
  const {Client}=require(path.join(repo,'backend/node_modules/pg')),url=name=>`postgresql://ai_qc_sandbox:${password}@127.0.0.1:59941/${name}`;
  const admin=new Client({connectionString:url('postgres'),connectionTimeoutMillis:5000});let db;
  const results=[];fs.mkdirSync(out,{recursive:true});
  const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','PATH','Path','PATHEXT'])if(process.env[key])env[key]=process.env[key];Object.assign(env,{TEMP:out,TMP:out,HOME:out,USERPROFILE:out,PGPASSWORD:password});
  const migration='20261101120000_native_ai_quality_control',stamp=Date.now().toString(36),name='ai_qc_sandbox_release_'+stamp,restore='ai_qc_sandbox_restore_'+stamp;
  const cli=(args,expected,code)=>{const result=spawnSync(process.execPath,[path.join(repo,'scripts/native-ai-qc-migrate.cjs'),...args],{cwd:out,env:{...env,DATABASE_URL:url(name)},encoding:'utf8',windowsHide:true});const record=JSON.parse(String(result.stdout||result.stderr).trim());if(result.status!==expected||(code&&record.code!==code))throw Error('Migration runner result mismatch: '+(record.code||record.status));results.push({args:args.filter(a=>!a.startsWith(out)),exitCode:result.status,result:record});return record;};
  const tool=(exe,args)=>{const r=spawnSync(path.join('C:\\Program Files\\PostgreSQL\\18\\bin',exe),args,{cwd:out,env,encoding:'utf8',windowsHide:true});if(r.status!==0)throw Error('Synthetic PostgreSQL tool failed: '+exe);};
  try{
    await admin.connect();const identity=(await admin.query("SELECT current_setting('data_directory') AS directory,inet_server_port() AS port")).rows[0];if(path.resolve(identity.directory).toLowerCase()!==path.join(root,'postgres-data').toLowerCase()||Number(identity.port)!==59941)throw Error('Cluster identity mismatch');
    for(const value of [name,restore]){if(!/^ai_qc_sandbox_[a-z0-9_]+$/.test(value))throw Error('Invalid test database');await admin.query('CREATE DATABASE "'+value+'"');}
    db=new Client({connectionString:url(name)});await db.connect();
    await db.query("CREATE TABLE public.native_qc_release_sentinel(id int PRIMARY KEY,value text NOT NULL); INSERT INTO public.native_qc_release_sentinel VALUES(1,'SYNTHETIC_ONLY')");
    await db.query(`CREATE TABLE public._prisma_migrations(id VARCHAR(36) PRIMARY KEY,checksum VARCHAR(64) NOT NULL,finished_at TIMESTAMPTZ,migration_name VARCHAR(255) NOT NULL,logs TEXT,rolled_back_at TIMESTAMPTZ,started_at TIMESTAMPTZ NOT NULL DEFAULT now(),applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
    await db.query('INSERT INTO public._prisma_migrations(id,checksum,finished_at,migration_name,applied_steps_count) VALUES($1,$2,now(),$3,1)',[crypto.randomUUID(),'0'.repeat(64),'synthetic-unrelated-history']);
    const backup=path.join(out,name+'.dump');tool('pg_dump.exe',['-h','127.0.0.1','-p','59941','-U','ai_qc_sandbox','-d',name,'-Fc','-f',backup]);const hash=crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
    tool('pg_restore.exe',['-h','127.0.0.1','-p','59941','-U','ai_qc_sandbox','-d',restore,'--exit-on-error','--no-owner','--no-privileges',backup]);
    const restored=new Client({connectionString:url(restore)});try{await restored.connect();if((await restored.query('SELECT value FROM public.native_qc_release_sentinel WHERE id=1')).rows[0]?.value!=='SYNTHETIC_ONLY')throw Error('Synthetic backup restore failed');}finally{await restored.end();}
    const pending=cli(['--check'],2);if(pending.status!=='PENDING_NEW_TABLE')throw Error('Unexpected initial schema');
    cli(['--apply'],1,'TARGET_AND_VERIFIED_BACKUP_REQUIRED');
    const args=['--apply','--expected-database',name,'--backup-file',backup,'--backup-sha256',hash];
    cli(['--apply','--expected-database','different-database','--backup-file',backup,'--backup-sha256',hash],1,'DATABASE_TARGET_MISMATCH');
    cli(['--apply','--expected-database',name,'--backup-file',backup,'--backup-sha256','1'.repeat(64)],1,'BACKUP_VERIFICATION_FAILED');
    if(cli(args,0).status!=='APPLIED'||cli(args,0).status!=='ALREADY_APPLIED'||cli(['--check'],0).status!=='UP_TO_DATE')throw Error('Apply/idempotency failed');
    let unique=false,version=false,payload=false;
    await db.query(`INSERT INTO public.native_ai_qc_workspace(organization_id,payload) VALUES('synthetic-tenant','{}'::jsonb)`);
    try{await db.query(`INSERT INTO public.native_ai_qc_workspace(organization_id,payload) VALUES('synthetic-tenant','{}'::jsonb)`);}catch(error){unique=error.code==='23505';}
    try{await db.query(`INSERT INTO public.native_ai_qc_workspace(organization_id,version,payload) VALUES('synthetic-negative',-1,'{}'::jsonb)`);}catch(error){version=error.code==='23514';}
    try{await db.query(`INSERT INTO public.native_ai_qc_workspace(organization_id,payload) VALUES('synthetic-array','[]'::jsonb)`);}catch(error){payload=error.code==='23514';}
    if(!unique||!version||!payload)throw Error('Native constraints not enforced');
    await db.query('BEGIN');await db.query(`INSERT INTO public.native_ai_qc_workspace(organization_id,payload) VALUES('synthetic-rollback','{}'::jsonb)`);await db.query('ROLLBACK');if((await db.query("SELECT 1 FROM public.native_ai_qc_workspace WHERE organization_id='synthetic-rollback'")).rows.length)throw Error('Rollback failed');
    await db.query('ALTER TABLE public.native_ai_qc_workspace ADD COLUMN unreviewed_synthetic text');cli(['--check'],1,'NATIVE_QC_COLUMN_DRIFT');await db.query('ALTER TABLE public.native_ai_qc_workspace DROP COLUMN unreviewed_synthetic');cli(['--check'],0);
    const history=await db.query('SELECT migration_name,count(*)::int AS count FROM public._prisma_migrations GROUP BY migration_name');if(history.rows.length!==2||!history.rows.some(r=>r.migration_name===migration&&r.count===1)||!history.rows.some(r=>r.migration_name==='synthetic-unrelated-history'&&r.count===1))throw Error('Unrelated history changed');
    if((await db.query('SELECT value FROM public.native_qc_release_sentinel WHERE id=1')).rows[0]?.value!=='SYNTHETIC_ONLY')throw Error('Unrelated data changed');
    const evidence={at:new Date().toISOString(),target:name,syntheticOnly:true,productionAccessed:false,backupRestore:'PASS',backupHash:hash,missingBackupBlocked:'PASS',wrongBackupBlocked:'PASS',wrongTargetBlocked:'PASS',apply:'PASS',idempotency:'PASS',uniqueConstraint:'PASS',nonnegativeVersion:'PASS',payloadObjectConstraint:'PASS',transactionRollback:'PASS',schemaDriftBlocked:'PASS',unrelatedHistoryPreserved:'PASS',unrelatedDataPreserved:'PASS',otherMigrationsExecuted:0,results};fs.writeFileSync(path.join(out,'migration-integration-results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({...evidence,results:undefined},null,2));
  }finally{if(db)await db.end().catch(()=>{});await admin.end().catch(()=>{});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
