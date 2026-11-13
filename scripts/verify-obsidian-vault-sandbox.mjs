// Runs only inside the existing CRM image with --network none and read-only mounts.
// No app listener, bootstrap, dotenv, credentials or application database is loaded.
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import Fastify from '/app/node_modules/fastify/fastify.js';
import {ObsidianKnowledgeService,KnowledgeApprovalService,KnowledgeRetrievalService,verifyCitation} from '/app/dist/modules/ai-quality-control/knowledge.js';
import {MemoryWorkspaceRepository} from '/app/dist/modules/ai-quality-control/repository.js';
import {providerEnvironment,AIProviderService} from '/app/dist/modules/ai-quality-control/providers.js';
import {aiQualityControlRoutes} from '/app/dist/modules/ai-quality-control/routes.js';

const root='/knowledge/obsidian',synthetic='/app/fixtures/ai-quality-control/vault';
const actor={id:'sandbox-reviewer',orgId:'obsidian-sandbox',departmentIds:[],permissions:['access','edit','create','approve','delete','view_all']};
const repo=new MemoryWorkspaceRepository(),vault=new ObsidianKnowledgeService(org=>org===actor.orgId?[root]:[],synthetic);
const environment=providerEnvironment({AI_QC_ENABLED:'true',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_REAL_API_ENABLED:'false',AI_QC_OUTBOUND_TEST_APPROVED:'false'});
assert.equal(environment.apiKey(),undefined);
const scanned=await vault.scan(actor,root);
assert.ok(scanned.documents.length>0,'Vault must contain readable Markdown');
assert.equal(scanned.issues.length,0,'Vault has scan issues; review before acceptance');
// Opening an existing file for writing does not modify it; the RO mount must deny it.
let writeDenied=false;
try {const handle=await fs.open(root+'/'+scanned.documents[0].sourcePath,'r+');await handle.close();}
catch(error){assert.ok(['EROFS','EACCES','EPERM'].includes(error.code));writeDenied=true;}
assert.equal(writeDenied,true,'Vault mount must deny write handles');
await assert.rejects(vault.scan({...actor,permissions:['access']},root),e=>e.statusCode===403);
await assert.rejects(vault.scan({...actor,orgId:'another-tenant'},root),e=>e.code==='VAULT_NOT_ALLOWED_FOR_TENANT');
await assert.rejects(vault.scan(actor,'/etc'),e=>e.code==='VAULT_NOT_ALLOWED_FOR_TENANT');
await assert.rejects(vault.scan(actor,'relative/vault'),e=>e.code==='VAULT_PATH_MUST_BE_ABSOLUTE');

const app=Fastify({logger:false});
await app.register(aiQualityControlRoutes({repo,environment,vault,syntheticVault:synthetic,storageMode:'memory',
 authenticate:async(req,reply)=>{if(req.headers['x-sandbox-auth']!=='yes')return reply.code(401).send({error:'UNAUTHORIZED'});},
 actor:async req=>req.headers['x-sandbox-access']==='denied'?{...actor,permissions:['access']}:actor,
 validateDepartments:async(_actor,ids)=>{assert.deepEqual(ids,[]);}}));
const request=async(method,url,payload,headers={})=>{
 const response=await app.inject({method,url:'/api/v1/ai-quality-control'+url,payload,headers:{'x-sandbox-auth':'yes',...headers}});
 return {status:response.statusCode,body:response.json()};
};
try {
 assert.equal((await request('GET','/status')).status,200);
 assert.equal((await request('GET','/status',undefined,{'x-sandbox-auth':'no'})).status,401);
 assert.equal((await request('PUT','/settings',{vaultPath:root})).status,200);
 const preview=await request('POST','/knowledge/preview');assert.equal(preview.status,200);
 const first=await request('POST','/knowledge/sync');assert.equal(first.status,200);assert.equal(first.body.added,scanned.documents.length);
 assert.equal((await request('POST','/knowledge/sync')).body.added,0);
 assert.equal((await request('POST','/knowledge/sync',undefined,{'x-sandbox-access':'denied'})).status,403);
 const state=await repo.read(actor.orgId);assert.ok(state.documents.every(d=>d.status==='DRAFT'&&d.revision===1));
 const retrieval=new KnowledgeRetrievalService();assert.equal(retrieval.retrieve(actor,state,'quy tắc khách hàng',true).chunks.length,0);
 const doc=state.documents.find(d=>d.sourcePath.startsWith('01_QUY_TAC_UNG_XU/'))??state.documents[0];
 const publication={hash:doc.contentHash,effectiveFrom:new Date(Date.now()-60000).toISOString(),effectiveTo:null,departmentIds:[],rule:{id:'SANDBOX-ONLY-REVIEW',type:'COURTESY',matchTerms:[],conflictGroup:null,slaSeconds:null,careIntervalDays:null}};
 assert.equal((await request('POST','/knowledge/'+doc.id+'/publish',{...publication,hash:'0'.repeat(64)})).status,409);
 assert.equal((await request('POST','/knowledge/'+doc.id+'/publish',publication,{'x-sandbox-access':'denied'})).status,403);
 assert.equal((await request('POST','/knowledge/'+doc.id+'/publish',publication)).status,200);
 const approved=await repo.read(actor.orgId),retrieved=retrieval.retrieve(actor,approved,'quy tắc ứng xử khách hàng',true);
 assert.ok(retrieved.chunks.length>0);assert.ok(retrieved.chunks.every(c=>c.versionId===doc.id));
 const current=approved.documents.find(d=>d.id===doc.id),citation=retrieved.chunks[0].citation;
 assert.equal(verifyCitation(current,citation),true);
 assert.equal(verifyCitation(current,{...citation,quote:citation.quote+' altered'}),false);
 assert.equal(verifyCitation(current,{...citation,revision:99}),false);
 assert.equal(verifyCitation(current,{...citation,contentHash:'0'.repeat(64)}),false);
 assert.equal((await request('POST','/knowledge/'+doc.id+'/citation',{...citation,quote:'invalid'})).body.valid,false);
 const dataset=await request('POST','/datasets',{name:'Obsidian sandbox synthetic',scenario:'polite'});assert.equal(dataset.status,200);
 const analysis=await request('POST','/datasets/'+dataset.body.id+'/analyze',{provider:'mock'});assert.equal(analysis.status,200);
 assert.ok(analysis.body.knowledgeSnapshot.some(d=>d.id===doc.id));assert.equal(analysis.body.provider,'mock');
 assert.equal((await request('POST','/knowledge/'+doc.id+'/revoke',{hash:doc.contentHash})).status,200);
 assert.equal(retrieval.retrieve(actor,await repo.read(actor.orgId),'quy tắc',true).chunks.length,0);
 assert.equal((await request('POST','/connection/test')).status,403);
 const final=await vault.scan(actor,root);
 assert.deepEqual(final.documents.map(d=>[d.sourcePath,d.contentHash]),scanned.documents.map(d=>[d.sourcePath,d.contentHash]));
 // Revision changes are tested only on a disposable local fixture, never on the user's Vault.
 const fixture='/tmp/obsidian-revision';await fs.mkdir(fixture);
 const testVault=new ObsidianKnowledgeService(()=>[fixture],synthetic),versions=new MemoryWorkspaceRepository();
 await fs.writeFile(fixture+'/rule.md','Synthetic rule revision one');await testVault.sync(actor,versions,fixture);
 await fs.writeFile(fixture+'/rule.md','Synthetic rule revision two');await testVault.sync(actor,versions,fixture);
 const history=(await versions.read(actor.orgId)).documents;assert.deepEqual(history.map(d=>d.revision),[1,2]);assert.equal(history[0].documentId,history[1].documentId);assert.notEqual(history[0].contentHash,history[1].contentHash);
 console.log(JSON.stringify({at:new Date().toISOString(),result:'PASS',runtime:'EXISTING_CRM_IMAGE_NO_LISTENER',vault:root,documents:scanned.documents.length,issues:scanned.issues.length,readOnlyMount:'PASS',vaultHashUnchanged:'PASS',draftExcluded:'PASS',approvedRetrieval:'PASS',revokedExcluded:'PASS',wrongPermission:'PASS',wrongTenant:'PASS',wrongPath:'PASS',wrongHash:'PASS',revisionChange:'PASS',invalidCitation:'PASS',existingRoutesViaInjection:'PASS',syntheticMockAnalysis:'PASS',providerOutboundDenied:'PASS',storage:'EPHEMERAL_MEMORY',realDatabaseAccessed:false,realApiCalled:false,productionApprovalChanged:false}));
}finally{await app.close();}
