// Run only the native QC tests, never load the app, dotenv, Zalo or existing test suites.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..'),evidence=path.resolve(root,'..','native-ai-qc-test-evidence-20261101');
if(!evidence.startsWith(path.resolve(root,'..')+path.sep)||evidence===root)throw Error('Invalid test evidence path');
fs.mkdirSync(evidence,{recursive:true});
const env={};
for(const key of ['SystemRoot','SYSTEMROOT','WINDIR','ComSpec','COMSPEC','PATH','Path','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(process.env[key])env[key]=process.env[key];
Object.assign(env,{NODE_ENV:'test',TZ:'UTC',TEMP:evidence,TMP:evidence,QC_TEST_ROOT:evidence,AI_QC_ENABLED:'true',AI_QC_REAL_API_ENABLED:'false',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_OUTBOUND_TEST_APPROVED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/ai_qc_sandbox_never_connect'});
fs.writeFileSync(path.join(evidence,'isolation.json'),JSON.stringify({createdAt:new Date().toISOString(),environmentNames:Object.keys(env).sort(),secretInheritance:false,dotenvLoaded:false,databaseConnectionAllowed:false,network:'Denied by test setup; all providers use local stubs',suite:'native-ai-quality-control.test.ts'},null,2));
const frontend=process.argv.includes('--frontend');
const result=spawnSync(process.execPath,[path.join(root,'backend','node_modules','vitest','vitest.mjs'),'run','--config',frontend?'vitest.native-ai-qc.config.mjs':'vitest.native-ai-qc.config.ts'],{cwd:path.join(root,frontend?'frontend':'backend'),env,stdio:'inherit'});
if(result.error){console.error(result.error.message);process.exit(1);}process.exit(result.status??1);
