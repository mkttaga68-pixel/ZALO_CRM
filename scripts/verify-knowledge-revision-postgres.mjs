// Only the recorded, identity-verified synthetic knowledge DB is permitted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {PrismaWorkspaceRepository} from '../backend/dist/modules/ai-quality-control/repository.js';
import {KnowledgeApprovalService,KnowledgeRetrievalService,digest} from '../backend/dist/modules/ai-quality-control/knowledge.js';
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),parent=path.resolve(repoRoot,'..','native-ai-qc-runtime');
const root=path.resolve(JSON.parse(fs.readFileSync(path.join(parent,'latest.json'),'utf8')).root);
assert.ok(root.startsWith(parent+path.sep));
const state=JSON.parse(fs.readFileSync(path.join(root,'runtime-evidence.json'),'utf8'));
assert.equal(state.syntheticOnly,true);assert.equal(state.ports.database,59941);
const name=state.databaseNames.find(v=>/^ai_qc_sandbox_knowledge_[a-z0-9_]+$/.test(v));assert.ok(name);
const password=fs.readFileSync(path.join(root,'postgres-password.synthetic'),'utf8');assert.match(password,/^[a-f0-9]{48}$/);
const require=createRequire(path.join(repoRoot,'backend/package.json'));
const {Client}=require('pg'),{PrismaClient}=require('@prisma/client'),{PrismaPg}=require('@prisma/adapter-pg');
const url=`postgresql://ai_qc_sandbox:${password}@127.0.0.1:59941/${name}`;
const guard=new Client({connectionString:url,connectionTimeoutMillis:3000});
await guard.connect();
try {
 const proof=(await guard.query("SELECT current_database() AS name,current_setting('data_directory') AS directory,inet_server_port() AS port")).rows[0];
 assert.equal(proof.name,name);assert.equal(Number(proof.port),59941);assert.equal(path.resolve(proof.directory).toLowerCase(),path.join(root,'postgres-data').toLowerCase());
}finally{await guard.end();}
const db=new PrismaClient({adapter:new PrismaPg({connectionString:url}),log:[]});
try {
 const store=new PrismaWorkspaceRepository(db),approval=new KnowledgeApprovalService(store),at=Date.now();
 const actor={id:'synthetic-reviewer',orgId:'synthetic-revision-concurrency-'+at,permissions:['access','create','edit','approve','view_all'],departmentIds:[]};
 const markdown='# SYNTHETIC ONLY\nDo not insult a customer.';
 const draft={id:'synthetic-r1',documentId:'synthetic-policy',orgId:actor.orgId,sourcePath:'synthetic.md',revision:1,contentHash:digest(markdown),markdown,category:'SYNTHETIC',synthetic:true,stagedBy:actor.id,status:'DRAFT',approvedBy:null,approvedAt:null,effectiveFrom:null,effectiveTo:null,departmentIds:[],rule:null};
 await store.mutate(actor.orgId,s=>{s.documents.push(draft);});
 const input={hash:draft.contentHash,effectiveFrom:new Date(at-1000).toISOString(),effectiveTo:null,departmentIds:[],rule:{id:'synthetic-rule',type:'INSULT',matchTerms:['insult'],conflictGroup:null,slaSeconds:null,careIntervalDays:null}};
 const outcomes=await Promise.allSettled([approval.publish(actor,draft.id,input),approval.publish(actor,draft.id,input)]);
 assert.equal(outcomes.filter(v=>v.status==='fulfilled').length,1);
 assert.equal(outcomes.filter(v=>v.status==='rejected').length,1);
 const snapshot=await store.read(actor.orgId);assert.equal(snapshot.authorityEpoch,1);assert.equal(snapshot.audits.filter(a=>a.action==='KNOWLEDGE_PUBLISH').length,1);
 const second={...draft,id:'synthetic-r2',revision:2,markdown:markdown+'\nNew revision.',contentHash:digest(markdown+'\nNew revision.')};
 await store.mutate(actor.orgId,s=>{s.documents.push(second);});
 await approval.publish(actor,second.id,{...input,hash:second.contentHash,effectiveFrom:new Date(at+86400000).toISOString()});
 const retrieval=new KnowledgeRetrievalService(),current=await store.read(actor.orgId);
 assert.equal(retrieval.retrieve(actor,current,'insult',true,new Date(at)).documents[0].revision,1);
 assert.equal(retrieval.retrieve(actor,current,'insult',true,new Date(at+86400000)).documents[0].revision,2);
 const before=JSON.stringify(current);
 await assert.rejects(store.mutate(actor.orgId,s=>{s.documents=[];throw Error('synthetic rollback');}));
 assert.equal(JSON.stringify(await store.read(actor.orgId)),before);
 const out=path.resolve(repoRoot,'..','obsidian-revision-fix-evidence-20261101');fs.mkdirSync(out,{recursive:true});
 const result={at:new Date().toISOString(),result:'PASS',database:'IDENTITY_VERIFIED_LOOPBACK_SYNTHETIC_KNOWLEDGE_DB',concurrentPublication:'ONE_COMMIT_ONE_REJECTION',publicationAudits:1,persistentScheduledTransition:'PASS',transactionRollback:'PASS',productionAccessed:false,outboundAiCalls:0};
 fs.writeFileSync(path.join(out,'postgres-concurrency.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await db.$disconnect();}
