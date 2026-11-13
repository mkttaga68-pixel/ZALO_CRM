// Separate sandbox ONLY. Default --plan does not load dotenv or connect anywhere.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const file=path.join(root,'backend/prisma/migrations/20261101120000_native_ai_quality_control/migration.sql');
const sql=fs.readFileSync(file,'utf8'),sha256=crypto.createHash('sha256').update(sql).digest('hex');
async function main(){
  const args=process.argv.slice(2);
  if(args.length!==1||!['--plan','--apply'].includes(args[0]))throw Error('Use --plan or --apply');
  if(args[0]==='--plan'){console.log(JSON.stringify({migration:'20261101120000_native_ai_quality_control',sha256,operations:['CREATE native_ai_qc_workspace'],connected:false},null,2));return;}
  if(process.env.AI_QC_SANDBOX_MIGRATION_APPROVED!=='true')throw Error('Explicit isolated sandbox migration approval required');
  const raw=process.env.AI_QC_SANDBOX_DATABASE_URL;if(!raw)throw Error('Separate sandbox URL required');
  const url=new URL(raw),name=decodeURIComponent(url.pathname.slice(1));
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!/^ai_qc_sandbox_[a-z0-9_]+$/.test(name))throw Error('Only named loopback sandbox databases allowed');
  if(process.env.DATABASE_URL&&decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))===name)throw Error('Target must differ from CRM database');
  const {Client}=require(path.join(root,'backend/node_modules/pg'));
  const client=new Client({connectionString:raw,connectionTimeoutMillis:5000,application_name:'native-ai-qc-sandbox-migration'});
  try{
    await client.connect();
    const identity=await client.query('SELECT current_database() AS name');if(identity.rows[0]?.name!==name)throw Error('Database identity mismatch');
    await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('native-ai-qc-sandbox-migration'))");
    const existing=await client.query("SELECT to_regclass('public.native_ai_qc_workspace') AS existing");
    if(existing.rows[0]?.existing)throw Error('Table already exists; explicit drift review required, no overwrite');
    await client.query(sql);await client.query('COMMIT');
    console.log(JSON.stringify({applied:true,migration:'20261101120000_native_ai_quality_control',sha256,sandboxName:name}));
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{await client.end().catch(()=>{});}
}
main().catch(()=>{console.error('Sandbox migration not applied or not confirmed. Check approval, target identity and schema; credentials are never printed.');process.exitCode=1;});
