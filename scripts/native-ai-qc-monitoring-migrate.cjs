// Owner-approved target only. No dotenv, ambient DATABASE_URL or other migrations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..'),root=path.resolve(repo,'..','native-ai-qc-runtime','mvxj0im3'),name='ai_qc_sandbox_knowledge_mvxj0im3';
async function main(){
 const action=process.argv[2];if(!['--apply','--check','--artifact-check'].includes(action)||process.argv.length!==3)throw Error('INVALID_ARGUMENTS');
 const dir=path.join(repo,'backend/prisma/migrations/20261101180000_native_ai_qc_monitoring_mock'),sql=fs.readFileSync(path.join(dir,'migration.sql'),'utf8'),manifest=JSON.parse(fs.readFileSync(path.join(dir,'migration.manifest.json'),'utf8').replace(/^\uFEFF/,''));
 if(crypto.createHash('sha256').update(sql).digest('hex')!==manifest.sha256||manifest.tables.length!==3||manifest.tables.some(t=>!/^native_ai_qc_monitoring_(job|warning|delivery)$/.test(t)))throw Error('ARTIFACT_MISMATCH');
 if(action==='--artifact-check'){console.log('MONITORING_ARTIFACT_VERIFIED');return;}
 const state=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));if(!state.syntheticOnly||state.ports.database!==59941||!state.databaseNames.includes(name))throw Error('SYNTHETIC_PROOF_MISSING');
 const password=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');if(!/^[a-f0-9]{48}$/.test(password))throw Error('SYNTHETIC_CREDENTIAL_INVALID');
 const {Client}=require(path.join(repo,'backend/node_modules/pg'));const client=new Client({connectionString:`postgresql://ai_qc_sandbox:${password}@127.0.0.1:59941/${name}`,connectionTimeoutMillis:3000,statement_timeout:10000});
 try{await client.connect();const proof=(await client.query("SELECT current_database() AS name,current_setting('data_directory') AS directory,inet_server_port() AS port")).rows[0];
  if(proof.name!==name||Number(proof.port)!==59941||path.resolve(proof.directory).toLowerCase()!==path.join(root,'postgres-data').toLowerCase())throw Error('CLUSTER_IDENTITY_MISMATCH');
  await client.query(action==='--apply'?'BEGIN':'BEGIN READ ONLY');
  const existing=[];for(const table of manifest.tables)if((await client.query('SELECT to_regclass($1) AS name',['public.'+table])).rows[0].name)existing.push(table);
  if(action==='--apply'){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('native-monitoring-mock-migration',0))");if(existing.length)throw Error('EXISTING_TABLE_REQUIRES_CHECK');await client.query(sql);}
  for(const table of manifest.tables){const cols=(await client.query('SELECT column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position',[table])).rows;
   if(JSON.stringify(cols)!==JSON.stringify([{column_name:'organization_id',data_type:'text',is_nullable:'NO'},{column_name:'id',data_type:'text',is_nullable:'NO'},{column_name:'payload',data_type:'jsonb',is_nullable:'NO'}]))throw Error('MONITORING_SCHEMA_NOT_READY');
  }
  await client.query('COMMIT');const result={at:new Date().toISOString(),status:action==='--apply'?'APPLIED_SYNTHETIC_ONLY':'SCHEMA_VERIFIED',database:name,tables:manifest.tables,sha256:manifest.sha256,otherMigrationsExecuted:0,productionTouched:false};
  const out=path.resolve(repo,'..','aiqc-monitoring-test-evidence-20261101');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,action==='--apply'?'sandbox-migration.json':'sandbox-schema-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
}
main().catch(error=>{console.error('MONITORING_MIGRATION_BLOCKED:',/^[A-Z_]+$/.test(error.message)?error.message:'DATABASE_OR_FILESYSTEM_ERROR');process.exitCode=1;});
