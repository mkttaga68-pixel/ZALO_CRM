// Fixture producer only: writes to the exact approved synthetic knowledge DB.
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
import {PostgresMonitoringRepository} from '../backend/dist/modules/ai-quality-control/monitoring/repository.js';
import {SyntheticMessageAdapter} from '../backend/dist/modules/ai-quality-control/monitoring/synthetic-message-adapter.js';
import {monitoringSettings} from '../backend/dist/modules/ai-quality-control/monitoring/settings.js';
import {syntheticConversation} from '../backend/dist/modules/ai-quality-control/synthetic.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),root=path.resolve(repo,'..','native-ai-qc-runtime','mvxj0im3'),out=path.resolve(repo,'..','aiqc-browser-e2e-20261101');
const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixtures.json'),'utf8')),state=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));if(!state.syntheticOnly||state.ports.database!==59941)throw Error('UNVERIFIED_SANDBOX');
const password=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');if(!/^[a-f0-9]{48}$/.test(password))throw Error('INVALID_SYNTHETIC_CREDENTIAL');
const original=net.Socket.prototype.connect;net.Socket.prototype.connect=function(...args){const raw=Array.isArray(args[0])?args[0]:args,first=raw[0],o=typeof first==='object'?first:{port:first,host:raw[1]};if(o.host!=='127.0.0.1'||Number(o.port)!==59941)throw Error('INJECTOR_OUTBOUND_DENIED');return original.apply(this,args);};globalThis.fetch=()=>{throw Error('INJECTOR_OUTBOUND_DENIED');};
const {Pool}=createRequire(path.join(repo,'backend/package.json'))('pg'),pool=new Pool({connectionString:`postgresql://ai_qc_sandbox:${password}@127.0.0.1:59941/ai_qc_sandbox_knowledge_mvxj0im3`});
try{const proof=(await pool.query("SELECT current_database() AS name,current_setting('data_directory') AS directory")).rows[0];if(proof.name!=='ai_qc_sandbox_knowledge_mvxj0im3'||path.resolve(proof.directory).toLowerCase()!==path.join(root,'postgres-data').toLowerCase())throw Error('IDENTITY_MISMATCH');
 const actor={id:fixture.owner.id,orgId:fixture.orgId,departmentIds:[],permissions:['access','create','edit','approve','view_all']},conversation=syntheticConversation(actor.orgId,'insult');
 const settings=monitoringSettings({NODE_ENV:'test',AI_QC_AUTO_MONITOR_ENABLED:'true',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_REAL_API_ENABLED:'false',AI_QC_OUTBOUND_TEST_APPROVED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false'},true);
 const result=await new SyntheticMessageAdapter(new PostgresMonitoringRepository(pool),settings).commit(actor,conversation,'browser-e2e-1');console.log(JSON.stringify({jobId:result.id,conversationId:conversation.id,orgId:actor.orgId,created:result.created}));
}finally{await pool.end();}
