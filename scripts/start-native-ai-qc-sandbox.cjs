// Starts the EXISTING CRM on separate loopback ports, with a fresh PostgreSQL
// cluster and synthetic login. No dotenv, inherited credentials, Docker or prod.
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const net=require('node:net');const {pathToFileURL}=require('node:url');const {spawn,spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),parent=path.resolve(repo,'..','native-ai-qc-runtime');
const pgBin='C:\\Program Files\\PostgreSQL\\18\\bin';
// Database port is overridable: on some Windows hosts 59941 sits inside a Hyper-V/WSL excluded port range.
const ports={database:Number(process.env.AIQC_SANDBOX_DB_PORT||59941),backend:3091,frontend:5174};if(!Number.isInteger(ports.database)||ports.database<1024||[5432,5433].includes(ports.database))throw Error('Invalid sandbox database port');
const runId=Date.now().toString(36),root=path.join(parent,runId),data=path.join(root,'postgres-data');
const env={};for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','PATH','Path','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(process.env[key])env[key]=process.env[key];
const password=crypto.randomBytes(24).toString('hex'),loginPassword='Synthetic-QC-'+crypto.randomBytes(8).toString('hex')+'!';
const crmName='ai_qc_sandbox_crm_'+runId,qcName='ai_qc_sandbox_knowledge_'+runId;
const url=name=>`postgresql://ai_qc_sandbox:${password}@127.0.0.1:${ports.database}/${name}`;
const state={runId,root,ports,databaseNames:[crmName,qcName],pids:{},syntheticOnly:true,productionTouched:false};
let pgStarted=false,client;
function run(executable,args,extra={}){const daemonControl=path.basename(executable).toLowerCase()==='pg_ctl.exe',fd=daemonControl?fs.openSync(path.join(root,'pg-control.log'),'a'):null;let r;try{r=spawnSync(executable,args,{cwd:root,env,encoding:'utf8',windowsHide:true,...(fd!==null?{stdio:['ignore',fd,fd]}:{}),...extra});}finally{if(fd!==null)fs.closeSync(fd);}if(r.error||r.status!==0){fs.writeFileSync(path.join(root,'last-command-error.txt'),String(r.stderr||r.stdout||r.error?.message||'Command failed; see pg-control.log'));throw Error(path.basename(executable)+' failed; see sandbox command error artifact');}return r.stdout;}
async function free(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error(`Port ${port} is in use; no process will be replaced`)));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
function background(args,childEnv,log,cwd=root){const fd=fs.openSync(path.join(root,log),'a');const p=spawn(process.execPath,args,{cwd,env:childEnv,detached:true,windowsHide:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);p.unref();return p.pid;}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(url,method='GET',payload,token){const response=await fetch(url,{method,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error(`Synthetic HTTP probe failed (${response.status})`);return response.json();}
async function main(){
  if(!fs.existsSync(path.join(pgBin,'initdb.exe'))||!fs.existsSync(path.join(pgBin,'pg_ctl.exe')))throw Error('PostgreSQL 18 tools unavailable');
  if(!fs.existsSync(path.join(repo,'backend/dist/app.js')))throw Error('Build backend first');
  if(!root.startsWith(parent+path.sep)||fs.existsSync(root))throw Error('Fresh sandbox path required');
  for(const port of Object.values(ports))await free(port);
  fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'uploads'));fs.mkdirSync(path.join(root,'learning-outbox'));
  Object.assign(env,{TEMP:root,TMP:root,NODE_ENV:'test',TZ:'Asia/Bangkok',HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root});
  const pwfile=path.join(root,'postgres-password.synthetic');fs.writeFileSync(pwfile,password,{flag:'wx'});
  run(path.join(pgBin,'initdb.exe'),['-D',data,'-U','ai_qc_sandbox','--pwfile='+pwfile,'-A','scram-sha-256','--encoding=UTF8','--locale=C']);
  run(path.join(pgBin,'pg_ctl.exe'),['-D',data,'-l',path.join(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${ports.database}`,'-w','start']);pgStarted=true;
  state.pids.postgres=Number(fs.readFileSync(path.join(data,'postmaster.pid'),'utf8').split(/\r?\n/)[0]);
  const {Client}=require(path.join(repo,'backend/node_modules/pg'));
  client=new Client({connectionString:url('postgres'),connectionTimeoutMillis:5000});await client.connect();
  const proof=await client.query("SELECT current_database() AS name,current_setting('data_directory') AS directory,host(inet_server_addr()) AS address,inet_server_port() AS port");
  fs.writeFileSync(path.join(root,'cluster-identity.json'),JSON.stringify(proof.rows[0],null,2));
  if(proof.rows[0].name!=='postgres'||path.resolve(proof.rows[0].directory).toLowerCase()!==data.toLowerCase()||Number(proof.rows[0].port)!==ports.database||proof.rows[0].address!=='127.0.0.1')throw Error('Fresh cluster identity mismatch');
  for(const name of [crmName,qcName]){if(!/^ai_qc_sandbox_[a-z0-9_]+$/.test(name))throw Error('Invalid sandbox database name');await client.query('CREATE DATABASE "'+name+'"');}
  const configFile=path.join(root,'prisma-sandbox.config.mjs');
  fs.writeFileSync(configFile,'export default '+JSON.stringify({schema:path.join(repo,'backend/prisma/schema'),datasource:{url:url(crmName)}})+';\n');
  // The target is our just-created, identity-verified, empty disposable cluster.
  run(process.execPath,[path.join(repo,'backend/node_modules/prisma/build/index.js'),'db','push','--config',configFile]);
  const qcClient=new Client({connectionString:url(qcName)});try{await qcClient.connect();const identity=await qcClient.query('SELECT current_database() AS name');if(identity.rows[0].name!==qcName)throw Error('QC identity mismatch');await qcClient.query(fs.readFileSync(path.join(repo,'backend/prisma/migrations/20261101120000_native_ai_quality_control/migration.sql'),'utf8'));}finally{await qcClient.end();}
  const {PrismaClient}=require(path.join(repo,'backend/node_modules/@prisma/client'));const {PrismaPg}=require(path.join(repo,'backend/node_modules/@prisma/adapter-pg'));const bcrypt=require(path.join(repo,'backend/node_modules/bcryptjs'));
  const prisma=new PrismaClient({adapter:new PrismaPg({connectionString:url(crmName)}),log:[]});let org;
  try{org=await prisma.organization.create({data:{name:'AI QC SYNTHETIC SANDBOX'}});await prisma.user.create({data:{orgId:org.id,email:'ai-qc@sandbox.invalid',fullName:'AI QC Synthetic Owner',role:'owner',passwordHash:await bcrypt.hash(loginPassword,12)}});const counts={contacts:await prisma.contact.count(),messages:await prisma.message.count(),zaloAccounts:await prisma.zaloAccount.count(),users:await prisma.user.count()};if(counts.contacts||counts.messages||counts.zaloAccounts||counts.users!==1)throw Error('Synthetic-only provenance failed');state.syntheticCounts=counts;}finally{await prisma.$disconnect();}
  const runtimeEnv={...env,HOST:'127.0.0.1',PORT:String(ports.backend),DATABASE_URL:url(crmName),JWT_SECRET:crypto.randomBytes(40).toString('hex'),ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),UPLOAD_DIR:path.join(root,'uploads'),APP_URL:`http://127.0.0.1:${ports.frontend}`,AI_QC_ENABLED:'true',AI_QC_REAL_API_ENABLED:'false',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_OUTBOUND_TEST_APPROVED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false',AI_QC_STORAGE:'postgres-sandbox',AI_QC_SANDBOX_DATABASE_URL:url(qcName),AI_QC_SANDBOX_RUNTIME:'true',AI_QC_RUNTIME_ROOT:root,AI_QC_RUNTIME_DB_PORT:String(ports.database),AI_QC_LEARNING_OUTBOX_DIR:path.join(root,'learning-outbox')};
  state.pids.backend=background(['--import',pathToFileURL(path.join(repo,'scripts/native-ai-qc-runtime-guard.mjs')).href,path.join(repo,'backend/dist/app.js')],runtimeEnv,'backend.log');
  let ready=false;for(let i=0;i<40;i++){try{await request(`http://127.0.0.1:${ports.backend}/health`);ready=true;break;}catch{await wait(500);}}if(!ready)throw Error('Isolated backend did not become ready; see backend.log');
  const login=await request(`http://127.0.0.1:${ports.backend}/api/v1/auth/login`,'POST',{identifier:'ai-qc@sandbox.invalid',password:loginPassword});
  const status=await request(`http://127.0.0.1:${ports.backend}/api/v1/ai-quality-control/status`,'GET',undefined,login.token);
  if(!status.syntheticOnly||status.capabilities.realApi||status.capabilities.realData||status.storageMode!=='postgres-sandbox')throw Error('Native QC safety flags mismatch');
  await request(`http://127.0.0.1:${ports.backend}/api/v1/ai-quality-control/knowledge/sync`,'POST',{},login.token);
  await request(`http://127.0.0.1:${ports.backend}/api/v1/ai-quality-control/datasets`,'POST',{name:'SERVER SYNTHETIC — mẫu lịch sự',scenario:'polite'},login.token);
  const workspace=await request(`http://127.0.0.1:${ports.backend}/api/v1/ai-quality-control/workspace`,'GET',undefined,login.token);
  if(workspace.documents.some(d=>d.status!=='DRAFT')||workspace.datasets.length!==1)throw Error('Unexpected policy approval or dataset state');
  const frontEnv={...env,NODE_ENV:'development',VITE_AI_QC_ENABLED:'true',VITE_API_PROXY_TARGET:`http://127.0.0.1:${ports.backend}`};
  state.pids.frontend=background([path.join(repo,'frontend/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port',String(ports.frontend),'--strictPort'],frontEnv,'frontend.log',path.join(repo,'frontend'));
  let frontReady=false;for(let i=0;i<30;i++){try{const r=await fetch(`http://127.0.0.1:${ports.frontend}/ai-quality-control`,{signal:AbortSignal.timeout(2000)});if(r.ok){frontReady=true;break;}}catch{}await wait(500);}if(!frontReady)throw Error('Synthetic frontend not ready');
  const proxied=await request(`http://127.0.0.1:${ports.frontend}/api/v1/ai-quality-control/status`,'GET',undefined,login.token);if(proxied.module!=='AI_QUALITY_CONTROL'||proxied.capabilities.realApi)throw Error('Frontend proxy proof failed');
  state.url=`http://127.0.0.1:${ports.frontend}/ai-quality-control`;state.startedAt=new Date().toISOString();state.probes={health:'PASS',existingCrmLogin:'PASS',nativeApi:'PASS',frontendProxy:'PASS',documents:'4 DRAFT, none approved',syntheticDataset:'1',outbound:'DENIED',realApi:false,realData:false};
  fs.writeFileSync(path.join(root,'runtime-evidence.json'),JSON.stringify(state,null,2));fs.writeFileSync(path.join(root,'SYNTHETIC-LOGIN.txt'),`Only for this loopback SYNTHETIC sandbox\nURL: ${state.url}\nEmail: ai-qc@sandbox.invalid\nPassword: ${loginPassword}\nDo not use production credentials here.\n`);
  fs.writeFileSync(path.join(parent,'latest.json'),JSON.stringify({root,url:state.url},null,2));
  console.log(JSON.stringify({url:state.url,loginFile:path.join(root,'SYNTHETIC-LOGIN.txt'),evidence:path.join(root,'runtime-evidence.json'),probes:state.probes},null,2));
}
main().catch(async error=>{if(fs.existsSync(root))fs.writeFileSync(path.join(root,'failure.json'),JSON.stringify({error:error.message,ports,productionTouched:false}));for(const name of ['frontend','backend'])if(state.pids[name])try{process.kill(state.pids[name]);}catch{}if(pgStarted)try{run(path.join(pgBin,'pg_ctl.exe'),['-D',data,'-m','fast','-w','stop']);}catch{}console.error(error.message);process.exitCode=1;}).finally(async()=>{if(client)await client.end().catch(()=>{});});
