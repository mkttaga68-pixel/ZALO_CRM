// Read only our recorded sandbox metadata; never reads production .env or Docker.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),parent=path.resolve(repo,'..','native-ai-qc-runtime');
async function main(){
  const root=path.resolve(JSON.parse(fs.readFileSync(path.join(parent,'latest.json'),'utf8')).root);if(!root.startsWith(parent+path.sep))throw Error('Invalid runtime root');
  const state=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));if(!state.syntheticOnly||state.ports.database!==59941||!/^ai_qc_sandbox_crm_[a-z0-9_]+$/.test(state.databaseNames[0]))throw Error('Not a verified sandbox');
  const password=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');if(!/^[a-f0-9]{48}$/.test(password))throw Error('Invalid synthetic credential');
  const url=`postgresql://ai_qc_sandbox:${password}@127.0.0.1:59941/${state.databaseNames[0]}`;
  const {Client}=require(path.join(repo,'backend/node_modules/pg')),client=new Client({connectionString:url,connectionTimeoutMillis:5000});
  try{await client.connect();const identity=(await client.query("SELECT current_database() AS name,current_setting('data_directory') AS directory")).rows[0];if(identity.name!==state.databaseNames[0]||path.resolve(identity.directory).toLowerCase()!==path.join(root,'postgres-data').toLowerCase())throw Error('Cluster identity mismatch');const counts=(await client.query('SELECT (SELECT count(*) FROM contacts)::int AS contacts,(SELECT count(*) FROM messages)::int AS messages,(SELECT count(*) FROM zalo_accounts)::int AS accounts')).rows[0];if(counts.contacts||counts.messages||counts.accounts)throw Error('CRM sandbox no longer empty; cannot prove synthetic boundary');}finally{await client.end();}
  const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','PATH','Path','PATHEXT'])if(process.env[key])env[key]=process.env[key];
  const login=fs.readFileSync(path.join(root,'SYNTHETIC-LOGIN.txt'),'utf8').match(/^Password: (.+)$/m)?.[1];if(!login?.startsWith('Synthetic-QC-'))throw Error('Synthetic login missing');
  Object.assign(env,{NODE_ENV:'production',DATABASE_URL:url,JWT_SECRET:crypto.randomBytes(40).toString('hex'),ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),TEMP:root,TMP:root,HOME:root,USERPROFILE:root,AI_QC_ENABLED:'true',AI_QC_STORAGE:'application',AI_QC_REAL_API_ENABLED:'false',AI_QC_OUTBOUND_TEST_APPROVED:'false',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false',QC_APP_INTEGRATION_ROOT:root,QC_SYNTHETIC_LOGIN:login});
  const result=spawnSync(process.execPath,[path.join(repo,'scripts/native-ai-qc-application-smoke.mjs')],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:45000});
  fs.writeFileSync(path.join(root,'application-mode-smoke.log'),String(result.stdout||'')+String(result.stderr||''));if(result.status!==0)throw Error('Application mode smoke failed; inspect synthetic test log');console.log(result.stdout);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
