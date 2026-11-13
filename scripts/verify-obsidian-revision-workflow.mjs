// Isolated synthetic workflow, no listener/bootstrap/CRM DB/real Vault/provider.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Fastify from '../backend/node_modules/fastify/fastify.js';
import {MemoryWorkspaceRepository} from '../backend/dist/modules/ai-quality-control/repository.js';
import {ObsidianKnowledgeService,KnowledgeRetrievalService} from '../backend/dist/modules/ai-quality-control/knowledge.js';
import {aiQualityControlRoutes} from '../backend/dist/modules/ai-quality-control/routes.js';
import {providerEnvironment} from '../backend/dist/modules/ai-quality-control/providers.js';
const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=path.resolve(repoRoot,'..','obsidian-e2e-readiness-20261101');
await fs.mkdir(evidence,{recursive:true});
const root=await fs.mkdtemp(path.join(evidence,'synthetic-vault-'));
const actor={id:'fixture-reviewer',orgId:'fixture-org',permissions:['access','create','edit','approve','view_all'],departmentIds:['fixture-dept']};
const store=new MemoryWorkspaceRepository(),vault=new ObsidianKnowledgeService(org=>org===actor.orgId?[root]:[],root);
const app=Fastify({logger:false}),retrieval=new KnowledgeRetrievalService();
await app.register(aiQualityControlRoutes({repo:store,vault,syntheticVault:root,storageMode:'memory',environment:providerEnvironment({AI_QC_ENABLED:'true'}),
 authenticate:async(req,reply)=>{if(req.headers['x-fixture-auth']!=='yes')return reply.code(401).send({error:'UNAUTHORIZED'});},
 actor:async req=>req.headers['x-fixture-role']==='reader'?{...actor,permissions:['access']}:actor,
 validateDepartments:async(_actor,ids)=>{assert.deepEqual(ids,['fixture-dept']);}}));
const call=async(method,url,payload,headers={})=>{const r=await app.inject({method,url:'/api/v1/ai-quality-control'+url,payload,headers:{'x-fixture-auth':'yes',...headers}});return {status:r.statusCode,body:r.json()};};
const publish=(doc,from)=>call('POST','/knowledge/'+doc.id+'/publish',{hash:doc.contentHash,effectiveFrom:from,effectiveTo:null,departmentIds:['fixture-dept'],rule:{id:'FIXTURE-RULE',type:'COURTESY',matchTerms:['tự đi mà tìm'],conflictGroup:null,slaSeconds:null,careIntervalDays:null}});
const picked=async(at)=>retrieval.retrieve(actor,await store.read(actor.orgId),'tự đi mà tìm',true,at).documents;
const result={at:new Date().toISOString(),scope:'SYNTHETIC_FIXTURE_ONLY',browserExecuted:false,realVaultTouched:false,realDatabaseAccessed:false,realApiCalled:false,productionChanged:false};
try {
 await fs.writeFile(path.join(root,'rule.md'),'# SYNTHETIC ONLY\nKhông nói tự đi mà tìm. Revision one.\n');
 assert.equal((await call('POST','/knowledge/sync')).status,200);
 const first=(await store.read(actor.orgId)).documents[0];assert.equal(first.status,'DRAFT');assert.equal((await picked()).length,0);
 assert.equal((await publish(first,new Date(Date.now()-60000).toISOString())).status,200);
 assert.equal((await picked())[0].revision,1);
 await fs.writeFile(path.join(root,'rule.md'),'# SYNTHETIC ONLY\nKhông nói tự đi mà tìm. Revision two, new rule text.\n');
 assert.equal((await call('POST','/knowledge/sync')).body.added,1);
 const second=(await store.read(actor.orgId)).documents.find(d=>d.revision===2);
 assert.notEqual(second.contentHash,first.contentHash);assert.equal(second.status,'DRAFT');
 assert.equal((await picked())[0].revision,1);result.unapprovedEditNotUsed='PASS';
 assert.equal((await call('POST','/knowledge/sync')).body.added,0);result.idempotentSync='PASS';
 assert.equal((await call('POST','/knowledge/sync',undefined,{'x-fixture-role':'reader'})).status,403);result.readOnlyActorDenied='PASS';
 const tomorrow=new Date(Date.now()+86400000),afterTomorrow=new Date(Date.now()+172800000);
 assert.equal((await publish(second,tomorrow.toISOString())).status,200);
 const beforeEffective=await picked();
 result.futurePublicationBeforeEffective={expectedRevision:1,actualRevisions:beforeEffective.map(d=>d.revision),pass:beforeEffective.some(d=>d.revision===1)};
 assert.equal((await picked(afterTomorrow))[0].revision,2);result.newRevisionAfterEffective='PASS';
 const state=await store.read(actor.orgId);
 assert.equal(retrieval.retrieve({...actor,id:'reader',permissions:['access'],departmentIds:['other-dept']},state,'rule',true,afterTomorrow).chunks.length,0);result.departmentAcl='PASS';
 assert.equal(retrieval.retrieve({...actor,orgId:'another-org'},state,'rule',true,afterTomorrow).chunks.length,0);result.tenantIsolation='PASS';
 result.status=result.futurePublicationBeforeEffective.pass?'PASS':'BLOCKED_FUTURE_EFFECTIVE_PUBLICATION_GAP';
 result.finding=result.futurePublicationBeforeEffective.pass?null:'Publishing a future-effective revision retired the old rule too early; see regression results.';
 await fs.writeFile(path.join(evidence,'revision-workflow.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 if(!result.futurePublicationBeforeEffective.pass)process.exitCode=2;
}finally{await app.close();}
