// Explicit owner-authorized synthetic API activation. Key never enters this
// process: PowerShell DPAPI decrypts it directly into the backend child ENV.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync,spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
const repo=path.resolve(__dirname,'..'),parent=path.resolve(repo,'..','native-ai-qc-runtime'),secrets=path.resolve(repo,'..','native-ai-qc-secrets');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const osEnv=()=>{const env={};for(const k of ['SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','PATH','Path','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(process.env[k])env[k]=process.env[k];return env;};
let phase='NOT_STARTED';const checkpoint=(name,code)=>{phase=name;fs.writeFileSync(path.join(parent,'openai-activation-progress.json'),JSON.stringify({at:new Date().toISOString(),phase:name,...(code?{code}:{}),secretLogged:false},null,2));};
async function main(){
  checkpoint('READ_SECURE_CONFIGURATION');
  const args=process.argv.slice(2);if(args.length!==1||!['--enable','--disable','--verify-existing'].includes(args[0]))throw Error('Use --enable, --disable or --verify-existing');const verifyExisting=args[0]==='--verify-existing',enable=args[0]!=='--disable';
  // All prerequisites precede stopping the existing sandbox process.
  const config=enable?JSON.parse(fs.readFileSync(path.join(secrets,'openai-config.json'),'utf8').replace(/^\uFEFF/,'')):null;
  if(enable&&(!fs.existsSync(path.join(secrets,'openai.dpapi'))||config.scope!=='SYNTHETIC_ONLY'||!config.responses||!config.structuredOutputs||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(config.model)))throw Error('Secure key/model setup missing');
  checkpoint('READ_SANDBOX_METADATA');
  const root=path.resolve(JSON.parse(fs.readFileSync(path.join(parent,'latest.json'),'utf8')).root);if(!root.startsWith(parent+path.sep))throw Error('Invalid runtime path');
  const state=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));if(!state.syntheticOnly||state.ports.database!==59941||state.ports.backend!==3091||state.ports.frontend!==5174)throw Error('Unexpected runtime identity');
  const secret=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');if(!/^[a-f0-9]{48}$/.test(secret))throw Error('Invalid generated sandbox database credential');
  const names=state.databaseNames;if(!Array.isArray(names)||names.length!==2||!/^ai_qc_sandbox_crm_[a-z0-9_]+$/.test(names[0])||!/^ai_qc_sandbox_knowledge_[a-z0-9_]+$/.test(names[1]))throw Error('Invalid sandbox names');
  const url=name=>`postgresql://ai_qc_sandbox:${secret}@127.0.0.1:59941/${name}`;
  const env={...osEnv(),NODE_ENV:'test',TZ:'Asia/Bangkok',HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,TEMP:root,TMP:root,HOST:'127.0.0.1',PORT:'3091',DATABASE_URL:url(names[0]),JWT_SECRET:crypto.randomBytes(40).toString('hex'),ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),UPLOAD_DIR:path.join(root,'uploads'),APP_URL:'http://127.0.0.1:5174',AI_QC_ENABLED:'true',AI_QC_REAL_API_ENABLED:enable?'true':'false',AI_QC_OUTBOUND_TEST_APPROVED:enable?'true':'false',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false',AI_QC_STORAGE:'postgres-sandbox',AI_QC_SANDBOX_DATABASE_URL:url(names[1]),AI_QC_SANDBOX_RUNTIME:'true',AI_QC_RUNTIME_ROOT:root,AI_QC_RUNTIME_DB_PORT:'59941'};
  if(enable){env.OPENAI_MODEL=config.model;env.AI_QC_MODEL_CAPABILITIES=JSON.stringify({[config.model]:{responses:true,structuredOutputs:true,reasoningEffort:config.reasoningEffort||'none'}});}
  // Verify this is the same disposable cluster before any restart.
  const {Client}=require(path.join(repo,'backend/node_modules/pg'));const db=new Client({connectionString:url(names[0]),connectionTimeoutMillis:5000});
  try{await db.connect();const result=await db.query("SELECT current_database() AS name,current_setting('data_directory') AS directory");if(result.rows[0]?.name!==names[0]||path.resolve(result.rows[0].directory).toLowerCase()!==path.join(root,'postgres-data').toLowerCase())throw Error('Sandbox cluster mismatch');}finally{await db.end().catch(()=>{});}
  checkpoint('CLUSTER_VERIFIED');
  const pid=Number(state.pids.backend);if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid recorded backend PID');
  if(!verifyExisting){const stopped=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){if(-not $p.CommandLine.Contains('native-ai-qc-runtime-guard.mjs')){throw 'Process identity mismatch'}; Stop-Process -Id ${pid} -ErrorAction Stop}`],{windowsHide:true,encoding:'utf8'});if(stopped.status!==0)throw Error('Cannot verify/stop isolated backend; no forced fallback');}
  let newPid;
  if(verifyExisting){newPid=Number(JSON.parse(fs.readFileSync(path.join(root,'openai-candidate-pid.json'),'utf8')).pid);if(!Number.isInteger(newPid)||newPid<=0)throw Error('Invalid candidate PID');}
  else if(enable){
    const id=crypto.randomBytes(10).toString('hex');env.AI_QC_ACTIVATION_ID=id;
    const out=fs.openSync(path.join(root,'secure-launch.log'),'a');
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(repo,'scripts/start-native-ai-qc-openai-backend.ps1'),'-RuntimeRoot',root,'-NodePath',process.execPath],{cwd:root,env,windowsHide:true,detached:true,stdio:['ignore',out,out]});fs.closeSync(out);child.unref();
    const marker=path.join(root,'openai-candidate-'+id+'.json');for(let i=0;i<30&&!fs.existsSync(marker);i++)await pause(500);
    if(!fs.existsSync(marker))throw Error('Secure backend startup failed; key not printed');newPid=Number(JSON.parse(fs.readFileSync(marker,'utf8')).pid);if(!Number.isInteger(newPid)||newPid<=0)throw Error('Invalid candidate PID');
  }
  else{const fd=fs.openSync(path.join(root,'backend-mock-restored.log'),'a');const child=spawn(process.execPath,['--import',pathToFileURL(path.join(repo,'scripts/native-ai-qc-runtime-guard.mjs')).href,path.join(repo,'backend/dist/app.js')],{cwd:root,env,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.unref();newPid=child.pid;}
  state.pids.backend=newPid;state.apiActivation={at:new Date().toISOString(),requested:enable,status:'STARTING',productionTouched:false};fs.writeFileSync(path.join(root,'runtime-evidence.json'),JSON.stringify(state,null,2));
  const base='http://127.0.0.1:5174/api/v1';let token;
  const call=async(method,endpoint,body)=>{const response=await fetch(base+endpoint,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});const value=await response.json();if(!response.ok)throw Error(typeof value.error==='string'?value.error:'Sandbox request failed');return value;};
  let ready=false;for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:3091/health',{signal:AbortSignal.timeout(1500)});if(r.ok){ready=true;break;}}catch{}await pause(500);}if(!ready)throw Error('Isolated backend readiness failed; no production changes');
  checkpoint('BACKEND_READY');
  const loginFile=fs.readFileSync(path.join(root,'SYNTHETIC-LOGIN.txt'),'utf8'),password=loginFile.match(/^Password: (.+)$/m)?.[1];if(!password?.startsWith('Synthetic-QC-'))throw Error('Synthetic login unavailable');token=(await call('POST','/auth/login',{identifier:'ai-qc@sandbox.invalid',password})).token;
  const status=await call('GET','/ai-quality-control/status');if(!status.syntheticOnly||status.capabilities.realData||status.capabilities.realApi!==enable||status.provider.apiKeyConfigured!==enable)throw Error('Runtime flag verification failed');
  let connection={status:enable?'NOT_RUN':'DISABLED'};
  await call('PUT','/ai-quality-control/settings',enable?{provider:'mock',model:config.model,maxOutputTokens:4096}:{provider:'mock',model:''});
  if(enable){checkpoint('OPENAI_SYNTHETIC_REQUEST');try{connection=await call('POST','/ai-quality-control/connection/test',{});await call('PUT','/ai-quality-control/settings',{provider:'openai',model:config.model});}catch(error){connection={status:'FAILED',errorCode:/^[A-Z0-9_]+$/.test(error.message)?error.message:'OPENAI_TEST_FAILED'};}}
  state.apiActivation={at:new Date().toISOString(),requested:enable,status:enable?'CONFIGURED_SYNTHETIC_ONLY':'DISABLED',connection,productionTouched:false};fs.writeFileSync(path.join(root,'runtime-evidence.json'),JSON.stringify(state,null,2));fs.writeFileSync(path.join(root,'openai-activation-evidence.json'),JSON.stringify(state.apiActivation,null,2));
  console.log(JSON.stringify({url:state.url,realData:false,productionTouched:false,keyConfigured:status.provider.apiKeyConfigured,realApi:status.capabilities.realApi,connection,reloginRequired:true},null,2));
  checkpoint('COMPLETE');
}
main().catch(error=>{checkpoint('BLOCKED_AT_'+phase,/^[A-Z0-9_]+$/.test(String(error.code))?error.code:'ACTIVATION_FAILED');console.error('Activation did not complete. Check secure key setup and sandbox logs; no secret values are printed.');process.exitCode=1;});
