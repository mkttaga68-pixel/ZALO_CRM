// Private helper: receives the DPAPI-decrypted key only via its environment.
// Output is strictly the backend PID; credentials are never printed or persisted.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url');
try{
  const repo=path.resolve(__dirname,'..'),parent=path.resolve(repo,'..','native-ai-qc-runtime'),root=path.resolve(process.env.AI_QC_RUNTIME_ROOT||'');
  if(!root.startsWith(parent+path.sep)||process.env.AI_QC_CREDENTIAL_SOURCE!=='WINDOWS_DPAPI'||!process.env.OPENAI_API_KEY||process.env.AI_QC_REAL_DATA_ENABLED!=='false'||process.env.AI_QC_REAL_API_ENABLED!=='true')throw Error('Invalid private child context');
  const out=fs.openSync(path.join(root,'backend-openai.log'),'a'),err=fs.openSync(path.join(root,'backend-openai-errors.log'),'a');
  const child=spawn(process.execPath,['--import',pathToFileURL(path.join(repo,'scripts/native-ai-qc-runtime-guard.mjs')).href,path.join(repo,'backend/dist/app.js')],{cwd:root,env:process.env,detached:true,windowsHide:true,stdio:['ignore',out,err]});
  fs.closeSync(out);fs.closeSync(err);child.unref();if(!child.pid)throw Error('Backend did not spawn');
  const record=JSON.stringify({pid:child.pid,at:new Date().toISOString()});
  fs.writeFileSync(path.join(root,'openai-candidate-pid.json'),record);
  if(/^[a-f0-9]{20}$/.test(process.env.AI_QC_ACTIVATION_ID||''))fs.writeFileSync(path.join(root,'openai-candidate-'+process.env.AI_QC_ACTIVATION_ID+'.json'),record);
  console.log(child.pid);
}catch{console.error('Private backend spawn failed; no credentials printed.');process.exitCode=1;}
