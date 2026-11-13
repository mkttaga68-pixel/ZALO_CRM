// Explicit opt-in, synthetic-only acceptance runner. No app bootstrap or CRM writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import OpenAI from '../backend/node_modules/openai/index.mjs';
import {OpenAIProvider,validateOutput} from '../backend/src/modules/ai-quality-control/providers.ts';
import {KnowledgeRetrievalService,digest,verifyCitation} from '../backend/src/modules/ai-quality-control/knowledge.ts';
import {safeOutboundFetch} from '../backend/src/shared/utils/safe-outbound-fetch.ts';
const require=createRequire(import.meta.url),{Client}=require('../backend/node_modules/pg');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),base=path.dirname(repo);
const evidence=path.join(base,'aiqc-semantic-session-20261102'),project='proj_6yDB6qP8X45ofaQO99BW2Bqy',model='gpt-6-luna';
const ledgerFile=path.join(evidence,'bounded-session.json'),stopFile=path.join(evidence,'STOP');
// This session replaces monetary prerequisites only for this explicit runner.
// It does not alter the production OpenAiControl or enable any runtime flag.
const reserve=(state,body,now,stop)=>{
 if(stop||now>=Date.parse(state.expiresAt))throw Error('SESSION_STOPPED_OR_EXPIRED');
 if(state.requests>=5)throw Error('SESSION_REQUEST_LIMIT');
 if(state.lastAt&&now-state.lastAt<12500)throw Error('SESSION_RATE_LIMIT');
 const payload=JSON.parse(body),source=JSON.parse(payload.input);
 if(payload.model!==model||payload.store!==false||payload.tools!==undefined||payload.stream||payload.background||payload.max_output_tokens>4096||payload.max_output_tokens<256||Buffer.byteLength(body)>65536||payload.text?.format?.name!=='native_ai_quality_control'||payload.text?.format?.strict!==true||source.conversation?.source!=='SERVER_SYNTHETIC'||!source.conversation?.id.startsWith('bounded-synthetic-')||!Array.isArray(source.knowledge)||source.knowledge.length>12)throw Error('SESSION_SYNTHETIC_CONTRACT');
 state.requests++;state.lastAt=now;
};
if(process.argv.includes('--self-test')){
 const body=JSON.stringify({model,store:false,max_output_tokens:1024,input:JSON.stringify({conversation:{id:'bounded-synthetic-self-test',source:'SERVER_SYNTHETIC'},knowledge:[]}),text:{format:{name:'native_ai_quality_control',strict:true}}});
 const s={requests:0,expiresAt:new Date(9999999).toISOString()};
 for(let i=0;i<5;i++)reserve(s,body,1000+i*13000,false);
 assert.throws(()=>reserve(s,body,100000,false),/REQUEST_LIMIT/);
 assert.throws(()=>reserve({...s,requests:0},body,100000,true),/STOPPED/);
 assert.throws(()=>reserve({...s,requests:0},body,9999999,false),/EXPIRED/);
 assert.throws(()=>reserve({...s,requests:0,lastAt:100000},body,100001,false),/RATE_LIMIT/);
 assert.throws(()=>reserve({...s,requests:0,lastAt:0},body.replace('SERVER_SYNTHETIC','CRM'),100000,false),/CONTRACT/);
 console.log(JSON.stringify({selfTest:'PASS',checks:5,apiRequests:0}));
}else if(process.argv.includes('--execute')){
 await runBoundedSyntheticSession();
}else{throw Error('EXPLICIT_EXECUTION_REQUIRED');}

async function runBoundedSyntheticSession(){
 fs.mkdirSync(evidence,{recursive:true});
 const lock=path.join(evidence,'session.lock');fs.mkdirSync(lock);
 let key='',db,ledger;
 const report={at:new Date().toISOString(),project,requestedModel:model,maxRequests:5,results:[],network:[],apiRequests:0,productionWrites:0,productionRestarted:false,realCustomerData:false,dashboard:'NOT_RUN',budgetIsBlocker:false};
 const persist=()=>fs.writeFileSync(ledgerFile,JSON.stringify(ledger,null,2));
 try{
  if(fs.existsSync(ledgerFile))ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
  else{ledger={project,model,requests:0,expiresAt:new Date(Date.now()+30*60000).toISOString()};fs.writeFileSync(ledgerFile,JSON.stringify(ledger),{flag:'wx'});}
  if(ledger.project!==project||ledger.model!==model||!Number.isSafeInteger(ledger.requests)||ledger.requests<0||ledger.requests>=5||Date.now()>=Date.parse(ledger.expiresAt))throw Error('SESSION_NOT_REUSABLE');
  const metadata=JSON.parse(fs.readFileSync(path.join(base,'aiqc-project-secrets/project.json'),'utf8'));
  if(metadata.project!==project||process.env.AI_QC_CREDENTIAL_SOURCE!=='WINDOWS_DPAPI_STDIN')throw Error('SECRET_CONTEXT_INVALID');
  key=fs.readFileSync(0,'utf8');if(!/^sk-[A-Za-z0-9_-]{17,}$/.test(key)||key.length>1024)throw Error('SECRET_FORMAT_INVALID');
  const fixture=JSON.parse(fs.readFileSync(path.join(base,'aiqc-browser-e2e-20261101/fixtures.json'),'utf8'));
  if(!path.resolve(fixture.vault).startsWith(path.join(base,'aiqc-browser-e2e-20261101','synthetic-vault-')))throw Error('FIXTURE_VAULT_INVALID');
  const root=path.join(base,'native-ai-qc-runtime/mvxj0im3'),password=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');
  if(!/^[a-f0-9]{48}$/.test(password))throw Error('SANDBOX_CREDENTIAL_INVALID');
  db=new Client({host:'127.0.0.1',port:59941,user:'ai_qc_sandbox',password,database:'ai_qc_sandbox_knowledge_mvxj0im3',connectionTimeoutMillis:3000});
  await db.connect();await db.query('BEGIN READ ONLY');
  const identity=(await db.query("SELECT current_database() AS name,current_setting('data_directory') AS directory,inet_server_port() AS port")).rows[0];
  if(identity.name!=='ai_qc_sandbox_knowledge_mvxj0im3'||Number(identity.port)!==59941||path.resolve(identity.directory).toLowerCase()!==path.join(root,'postgres-data').toLowerCase())throw Error('SANDBOX_IDENTITY_INVALID');
  report.database=identity;report.readOnly=true;
  const row=(await db.query('SELECT payload FROM native_ai_qc_workspace WHERE organization_id=$1',[fixture.orgId])).rows[0];
  const state=row?.payload;if(!state)throw Error('WORKSPACE_MISSING');
  const actor={id:fixture.owner.id,orgId:fixture.orgId,permissions:['access','create','edit','approve','view_all'],departmentIds:state.documents.flatMap(d=>d.departmentIds)};
  const scenarios=[
   ['staff-insults-customer',[['CUSTOMER','Tôi cần hỗ trợ đổi sản phẩm.'],['HUMAN','Đồ ngu, chuyện đơn giản vậy cũng không hiểu.']]],
   ['customer-insults-staff',[['CUSTOMER','Đồ ngu, tôi muốn đổi hàng.'],['HUMAN','Em xin phép kiểm tra điều kiện đổi hàng để hỗ trợ anh ạ.']]],
   ['warm-staff',[['CUSTOMER','Tôi muốn biết chính sách đổi hàng.'],['HUMAN','Dạ em cảm ơn anh đã liên hệ. Anh cho em biết sản phẩm cần đổi, em sẽ kiểm tra và hỗ trợ mình ạ.']]],
   ['staff-blames-customer',[['CUSTOMER','Tôi chưa hiểu hướng dẫn.'],['HUMAN','Đọc kỹ còn không làm được thì lỗi là ở anh, đừng làm mất thời gian của tôi.']]],
   ['missing-context',[['UNKNOWN','Thế thì cứ như vậy đi.']]]
  ];
  const environment={enabled:true,realApi:true,realData:false,outboundTestApproved:true,realDataOutboundApproved:false,apiKey:()=>key,capabilities:{[model]:{responses:true,structuredOutputs:true,reasoningEffort:'none'}}};
  let active=false;
  const transport=async(resource,init)=>{
   if(active)throw Error('SESSION_CONCURRENT_REQUEST');
   const url=String(resource),headers=new Headers(init?.headers);
   if(url!=='https://api.openai.com/v1/responses'||init?.method!=='POST'||headers.get('OpenAI-Project')!==project)throw Error('SESSION_EGRESS_DENIED');
   reserve(ledger,String(init.body),Date.now(),fs.existsSync(stopFile));persist();active=true;
   report.apiRequests=ledger.requests;
   try{
    const response=await safeOutboundFetch(url,{method:'POST',headers:{authorization:headers.get('authorization'),'OpenAI-Project':project,'content-type':'application/json'},body:String(init.body),timeoutMs:15000,maxBytes:1024*1024,signal:init.signal});
    const event={request:ledger.requests,endpoint:'POST /v1/responses',status:response.status};
    if(response.ok){const body=await response.clone().json();event.model=body.model;event.usage=body.usage;}
    else{try{const body=await response.clone().json();if(/^[a-z0-9_]{1,80}$/.test(body.error?.code??''))event.errorCode=body.error.code;}catch{}}
    report.network.push(event);return response;
   }finally{active=false;}
  };
  const settings={...state.settings,provider:'openai',model,inputUsdPerMillion:0.10,outputUsdPerMillion:0.50,maxOutputTokens:4096};
  const provider=new OpenAIProvider(environment,settings,()=>new OpenAI({apiKey:key,project,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:15000,logLevel:'off',fetch:transport}));
  for(const [name,lines]of scenarios){
   if(ledger.requests>=5||fs.existsSync(stopFile))break;
   const delay=ledger.lastAt?Math.max(0,12500-(Date.now()-ledger.lastAt)):0;if(delay)await new Promise(r=>setTimeout(r,delay));
   const now=new Date(),conversation={id:'bounded-synthetic-'+name,orgId:fixture.orgId,source:'SERVER_SYNTHETIC',messages:lines.map(([role,text],i)=>({id:name+'-m'+i,text,role,occurredAt:new Date(now.getTime()-60000+i*10000).toISOString(),actorId:role==='HUMAN'?'synthetic-staff':null,attribution:role==='UNKNOWN'?'UNKNOWN':'VERIFIED',timestampStatus:'VERIFIED'})),departmentIds:actor.departmentIds,coverage:name==='missing-context'?'UNKNOWN':'VERIFIED',assignedActorId:'synthetic-staff',assignmentStatus:'VERIFIED',workIntervals:null,offDayIntervals:null,observationEndAt:now.toISOString(),provenanceHash:null};
   // Re-read current authority for each request, still in the read-only transaction.
   const current=(await db.query('SELECT payload FROM native_ai_qc_workspace WHERE organization_id=$1',[fixture.orgId])).rows[0].payload;
   const retrieved=new KnowledgeRetrievalService().retrieve(actor,current,conversation.messages.map(m=>m.text).join('\n'),true,now);
   if(!retrieved.chunks.length||retrieved.documents.some(d=>d.contentHash!==digest(d.markdown)||d.status!=='APPROVED'))throw Error('APPROVED_KNOWLEDGE_MISSING');
   const result={scenario:name,conversation,knowledge:retrieved.documents.map(d=>({documentId:d.documentId,revision:d.revision,contentHash:d.contentHash,ruleId:d.rule.id,sourcePath:d.sourcePath}))};
   try{
    const response=await provider.analyze({conversation,knowledge:retrieved.chunks,maxOutputTokens:4096});
    validateOutput(response.output);
    const citationsValid=response.output.findings.every(f=>f.messageIds.every(id=>conversation.messages.some(m=>m.id===id))&&f.citations.every(c=>retrieved.documents.some(d=>verifyCitation(d,c))));
    result.status=citationsValid?'PASS':'FAIL';result.schemaValidation='PASS';result.citationsValid=citationsValid;result.analysis=response.output;result.usage=response.usage;
   }catch(error){result.status='FAIL';result.error=/^[A-Z0-9_]{3,80}$/.test(error.code??'')?error.code:'REQUEST_FAILED';report.results.push(result);break;}
   report.results.push(result);fs.writeFileSync(path.join(evidence,'bounded-api-results.json'),JSON.stringify(report,null,2));
  }
  await db.query('ROLLBACK');
  report.status=report.results.length&&report.results.every(r=>r.status==='PASS')?'PASS':'FAIL';
 }catch(error){report.status='BLOCKED';report.error=/^[A-Z0-9_]{3,80}$/.test(error.message??'')?error.message:'PREFLIGHT_OR_EXECUTION_FAILED';}
 finally{
  key='';if(db)await db.end().catch(()=>{});
  report.apiRequests=ledger?.requests??0;
  report.tokenUsage=report.network.filter(e=>e.usage).reduce((s,e)=>({input:s.input+e.usage.input_tokens,output:s.output+e.usage.output_tokens}),{input:0,output:0});
  report.usageReported=report.network.some(e=>e.usage);
  report.estimatedCostUsd=report.usageReported?(report.tokenUsage.input*0.10+report.tokenUsage.output*0.50)/1000000:null;
  report.costBasis='Standard gpt-6-luna public rates; estimate, not billing invoice';
  fs.writeFileSync(stopFile,'SESSION_CLOSED\n');
  fs.writeFileSync(path.join(evidence,'bounded-api-results.json'),JSON.stringify(report,null,2));
  fs.rmdirSync(lock);console.log(JSON.stringify({status:report.status,error:report.error,apiRequests:report.apiRequests,http:report.network.map(e=>({status:e.status,errorCode:e.errorCode,model:e.model})),tokenUsage:report.tokenUsage,estimatedCostUsd:report.estimatedCostUsd,results:report.results.map(r=>({scenario:r.scenario,status:r.status,error:r.error,schemaValidation:r.schemaValidation,citationsValid:r.citationsValid}))}));
 }
}
