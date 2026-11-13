const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..'),root=path.resolve(repo,'..','aiqc-readiness-closure-20261102','tests-'+Date.now());
fs.mkdirSync(root,{recursive:true});const env={};for(const k of ['SystemRoot','WINDIR','ComSpec','PATH','Path','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'])if(process.env[k])env[k]=process.env[k];
Object.assign(env,{NODE_ENV:'test',TZ:'UTC',TEMP:root,TMP:root,QC_TEST_ROOT:root,AI_QC_REAL_API_ENABLED:'false',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_OUTBOUND_TEST_APPROVED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/ai_qc_sandbox_never_connect'});
const frontend=process.argv.includes('--frontend'),config=frontend?'vitest.manual-real.config.mjs':process.argv.includes('--monitoring')?'vitest.native-ai-qc-monitoring.config.ts':'vitest.openai-control.config.ts';
const r=spawnSync(process.execPath,[path.join(repo,'backend/node_modules/vitest/vitest.mjs'),'run','--config',config],{cwd:path.join(repo,frontend?'frontend':'backend'),env,encoding:'utf8',windowsHide:true});
fs.writeFileSync(path.join(root,'execution.log'),r.stdout+'\n'+r.stderr);console.log(r.stdout);console.log(r.stderr);console.log('EVIDENCE: '+root);process.exitCode=r.status??1;
