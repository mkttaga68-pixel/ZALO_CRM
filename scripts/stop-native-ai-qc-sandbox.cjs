// Stops only processes proven to belong to our separately created sandbox.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),parent=path.resolve(repo,'..','native-ai-qc-runtime');
try{
  const latest=JSON.parse(fs.readFileSync(path.join(parent,'latest.json'),'utf8')),root=path.resolve(latest.root);
  if(!root.startsWith(parent+path.sep)||root===parent)throw Error('Invalid sandbox path');
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));
  if(path.resolve(evidence.root)!==root||evidence.syntheticOnly!==true)throw Error('Missing sandbox evidence');
  for(const [name,fragment]of [['frontend','vite/bin/vite.js'],['backend','native-ai-qc-runtime-guard.mjs']]){
    const pid=Number(evidence.pids[name]);if(!Number.isInteger(pid)||pid<=0)throw Error('Invalid sandbox process ID');
    const escaped=fragment.replace(/'/g,"''");
    const script=`$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if($p){if(-not $p.CommandLine.Replace([char]92,[char]47).Contains('${escaped}')){throw 'Process identity mismatch'}; Stop-Process -Id ${pid} -ErrorAction Stop}`;
    const stopped=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8'});if(stopped.status!==0)throw Error('Cannot verify/stop '+name+' process; no forced fallback');
  }
  const data=path.join(root,'postgres-data'),pidFile=path.join(data,'postmaster.pid');
  if(fs.existsSync(pidFile)){
    const actual=Number(fs.readFileSync(pidFile,'utf8').split(/\r?\n/)[0]);if(actual!==Number(evidence.pids.postgres))throw Error('PostgreSQL identity mismatch');
    const stop=spawnSync('C:\\Program Files\\PostgreSQL\\18\\bin\\pg_ctl.exe',['-D',data,'-m','fast','-w','stop'],{windowsHide:true,stdio:'inherit'});if(stop.status!==0)throw Error('Sandbox PostgreSQL stop failed');
  }
  fs.writeFileSync(path.join(root,'stopped.json'),JSON.stringify({at:new Date().toISOString(),dataDeleted:false,productionTouched:false},null,2));console.log('Sandbox stopped. Synthetic data/evidence retained.');
}catch(error){console.error(error.message);process.exitCode=1;}
