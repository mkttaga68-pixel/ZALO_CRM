// Explicit operator operation; never called from app startup and never resets a ledger.
const fs=require('node:fs'),path=require('node:path');
const [action,target]=process.argv.slice(2),project='proj_6yDB6qP8X45ofaQO99BW2Bqy';
if(!['--initialize-disabled','--disable'].includes(action)||!target||!path.isAbsolute(target)||process.argv.length!==4)throw Error('Use --initialize-disabled | --disable and an absolute control directory');
const root=path.resolve(target);
if(action==='--initialize-disabled'){
 if(fs.existsSync(root)||fs.realpathSync(path.dirname(root))!==path.dirname(root))throw Error('Refusing existing or redirected control directory');
 fs.mkdirSync(root,{mode:0o700});
 const files={'policy.json':JSON.stringify({project,model:'gpt-6-luna',enabled:false,dailyUsd:2,monthlyUsd:30,maxConcurrent:1,requestsPerMinute:5,dailyTokenBudget:50000},null,2),'ledger.json':JSON.stringify({version:1,project,blocked:false,entries:[]}),enabled:'DISABLED'};
 for(const[name,body]of Object.entries(files))fs.writeFileSync(path.join(root,name),body,{flag:'wx',mode:0o600});
 console.log('Initialized DISABLED policy; no secret, API request or database access.');
}else{
 if(fs.realpathSync(root)!==root||JSON.parse(fs.readFileSync(path.join(root,'policy.json'),'utf8')).project!==project)throw Error('Control identity mismatch');
 const temp=path.join(root,'disable-'+Date.now());fs.writeFileSync(temp,'DISABLED',{flag:'wx',mode:0o600});fs.renameSync(temp,path.join(root,'enabled'));
 console.log('Future dispatch disabled; existing in-flight requests may take up to their timeout. Budget retained.');
}
