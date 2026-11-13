import {describe,it,expect,vi} from 'vitest';
import path from 'node:path';
import Fastify from 'fastify';
import type {Actor,WorkspaceRepository} from '../src/modules/ai-quality-control/contracts.js';
import {MemoryWorkspaceRepository} from '../src/modules/ai-quality-control/repository.js';
import {ObsidianKnowledgeService,KnowledgeApprovalService,digest} from '../src/modules/ai-quality-control/knowledge.js';
import {syntheticConversation,conversationHash} from '../src/modules/ai-quality-control/synthetic.js';
import {MemoryMonitoringRepository,PostgresMonitoringRepository} from '../src/modules/ai-quality-control/monitoring/repository.js';
import {purgeMonitoring,MONITORING_LIMITS} from '../src/modules/ai-quality-control/monitoring/retention.js';
import {monitoringHealth} from '../src/modules/ai-quality-control/monitoring/health.js';
import {MonitoringQueue} from '../src/modules/ai-quality-control/monitoring/queue.js';
import {MonitoringWorker} from '../src/modules/ai-quality-control/monitoring/worker.js';
import {SyntheticMessageAdapter} from '../src/modules/ai-quality-control/monitoring/synthetic-message-adapter.js';
import {MonitoringSlaScheduler} from '../src/modules/ai-quality-control/monitoring/sla-scheduler.js';
import {monitoringSettings} from '../src/modules/ai-quality-control/monitoring/settings.js';
import {warningEvidenceValid} from '../src/modules/ai-quality-control/monitoring/warning-engine.js';
import {MonitoringNotifications} from '../src/modules/ai-quality-control/monitoring/notification-outbox.js';
import {monitoringRoutes} from '../src/modules/ai-quality-control/monitoring/routes.js';
const actor:Actor={id:'synthetic-owner',orgId:'synthetic-org-A',departmentIds:['department-A'],permissions:['access','create','edit','approve','view_all']};
const fixture=path.resolve('fixtures/ai-quality-control/vault');
const allowed=()=>monitoringSettings({NODE_ENV:'test',AI_QC_AUTO_MONITOR_ENABLED:'true',AI_QC_REAL_API_ENABLED:'false',AI_QC_REAL_DATA_ENABLED:'false',AI_QC_OUTBOUND_TEST_APPROVED:'false',AI_QC_REAL_DATA_OUTBOUND_APPROVED:'false'},true);
async function harness(approved=true){
 const workspace=new MemoryWorkspaceRepository(),vault=new ObsidianKnowledgeService(()=>[fixture],fixture),approval=new KnowledgeApprovalService(workspace);await vault.sync(actor,workspace,fixture);
 if(approved)for(const doc of (await workspace.read(actor.orgId)).documents){const type=doc.sourcePath.includes('courtesy')?'COURTESY':doc.sourcePath.includes('request')?'UNRESOLVED_REQUEST':doc.sourcePath.includes('product')?'KNOWLEDGE_MISMATCH':'INSULT';await approval.publish(actor,doc.id,{hash:doc.contentHash,effectiveFrom:new Date(Date.now()-86400000).toISOString(),effectiveTo:null,departmentIds:[],rule:{id:'fixture-'+type,type,matchTerms:[type==='INSULT'?'đồ ngu':type==='COURTESY'?'tự đi mà tìm':'SYNTHETIC-A miễn phí'],conflictGroup:null,slaSeconds:type==='UNRESOLVED_REQUEST'?300:null,careIntervalDays:null}});}
 const store=new MemoryMonitoringRepository(),settings=allowed();let time=Date.now();const clock=()=>time,resolve=vi.fn(async(id:string,orgId:string)=>({...actor,id,orgId}));
 const queue=new MonitoringQueue(store,settings,clock),adapter=new SyntheticMessageAdapter(store,settings,clock),worker=new MonitoringWorker(queue,workspace,resolve);
 const conversation=syntheticConversation(actor.orgId,'insult');
 return {workspace,approval,store,settings,clock,resolve,queue,adapter,worker,conversation,advance:(n:number)=>{time+=n;}};
}
describe('synthetic monitoring isolation and persistence contract',()=>{
 it('defaults OFF and rejects unverified or production enablement',()=>{expect(monitoringSettings({}).enabled).toBe(false);expect(()=>monitoringSettings({NODE_ENV:'production',AI_QC_AUTO_MONITOR_ENABLED:'true'},true)).toThrow('SYNTHETIC_PROOF_REQUIRED');expect(()=>monitoringSettings({NODE_ENV:'test',AI_QC_AUTO_MONITOR_ENABLED:'true'},false)).toThrow('SYNTHETIC_PROOF_REQUIRED');});
 it('OFF enqueues nothing and does not start processing',async()=>{const h=await harness();h.settings.enabled=false;expect(await h.adapter.commit(actor,h.conversation,'1')).toMatchObject({created:false});expect(await h.worker.tick(actor.orgId)).toBeNull();expect((await h.store.read(actor.orgId)).jobs).toEqual([]);expect(h.resolve).not.toHaveBeenCalled();});
 it('persists the source snapshot and job once for a duplicate synthetic event',async()=>{const h=await harness();const first=await h.adapter.commit(actor,h.conversation,'1'),second=await h.adapter.commit(actor,h.conversation,'1');expect(first.created).toBe(true);expect(second).toMatchObject({created:false,id:first.id});const state=await h.store.read(actor.orgId);expect(state.jobs).toHaveLength(1);expect(state.jobs[0]?.conversation).toEqual(h.conversation);});
 it('rejects a changed payload under the same source revision',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');h.conversation.messages[0]!.text='changed';h.conversation.provenanceHash=conversationHash(h.conversation);await expect(h.adapter.commit(actor,h.conversation,'1')).rejects.toThrow('EVENT_REVISION_CONFLICT');});
 it('rejects real data, cross-tenant input and invalid provenance',async()=>{const h=await harness();for(const c of [{...h.conversation,source:'CRM' as const},{...h.conversation,orgId:'other'},{...h.conversation,provenanceHash:'bad'}])await expect(h.adapter.commit(actor,c,'1')).rejects.toThrow('SYNTHETIC_EVENT_INVALID');expect((await h.store.read(actor.orgId)).jobs).toHaveLength(0);});
 it('analyzes with Mock and persists warnings/evidence/outbox atomically and idempotently',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);const s=await h.store.read(actor.orgId);expect(s.jobs[0]?.state).toBe('DONE');expect(s.warnings.some(w=>w.category==='CONDUCT_NEEDS_REVIEW')).toBe(true);expect(s.warnings.every(w=>warningEvidenceValid(w)&&w.evidence.provider==='mock')).toBe(true);expect(s.deliveries).toHaveLength(s.warnings.length);expect(await h.worker.tick(actor.orgId)).toBeNull();expect((await h.store.read(actor.orgId)).warnings).toEqual(s.warnings);});
 it('expired lease can be reclaimed and stale worker cannot complete',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');const stale=await h.queue.claim(actor.orgId);h.advance(h.settings.leaseMs+1);const restarted=new MonitoringWorker(new MonitoringQueue(h.store,h.settings,h.clock),h.workspace,h.resolve);await restarted.tick(actor.orgId);const s=await h.store.read(actor.orgId);expect(s.jobs[0]?.state).toBe('DONE');expect(s.jobs[0]?.attempts).toBe(2);expect(()=>h.queue.assertLease(s.jobs[0],stale!)).toThrow('STALE_LEASE');expect(new Set(s.warnings.map(w=>w.id)).size).toBe(s.warnings.length);});
 it('transient failures back off and dead-letter after four attempts without raw error disclosure',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');h.resolve.mockRejectedValue(Error('secret raw failure'));for(let i=0;i<4;i++){await h.worker.tick(actor.orgId);const j=(await h.store.read(actor.orgId)).jobs[0]!;if(i<3){expect(j.state).toBe('RETRY');expect(j.dueAt-h.clock()).toBe(h.settings.backoffMs*2**i);expect(await h.worker.tick(actor.orgId)).toBeNull();h.advance(j.dueAt-h.clock());}}
  const state=await h.store.read(actor.orgId);expect(state.jobs[0]).toMatchObject({state:'DEAD',attempts:4,error:'MONITORING_PROCESSING_FAILED'});expect(state.warnings).toEqual([]);
 });
 it('a revoked actor is terminal and other tenants cannot claim the job',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');expect(await h.worker.tick('other')).toBeNull();h.resolve.mockResolvedValue({...actor,permissions:[]});await h.worker.tick(actor.orgId);expect((await h.store.read(actor.orgId)).jobs[0]?.state).toBe('DEAD');});
 it.each(['missing-actor','missing-coverage'])('never creates a conduct/SLA warning for %s',async scenario=>{const h=await harness();const c=syntheticConversation(actor.orgId,scenario);await h.adapter.commit(actor,c,'1');await h.worker.tick(actor.orgId);const s=await h.store.read(actor.orgId);expect(s.warnings.length).toBeGreaterThan(0);expect(s.warnings.every(w=>w.category==='INSUFFICIENT_EVIDENCE'&&w.employeeId===null)).toBe(true);});
 it('excludes DRAFT and revoked rules',async()=>{const h=await harness(false);await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);expect((await h.store.read(actor.orgId)).warnings.every(w=>w.category==='INSUFFICIENT_EVIDENCE')).toBe(true);
  const ready=await harness();for(const d of (await ready.workspace.read(actor.orgId)).documents)await ready.approval.revoke(actor,d.id,d.contentHash);await ready.adapter.commit(actor,ready.conversation,'1');await ready.worker.tick(actor.orgId);expect((await ready.store.read(actor.orgId)).warnings.every(w=>w.category==='INSUFFICIENT_EVIDENCE')).toBe(true);
 });
 it('future-effective successor does not replace the current rules in warning evidence',async()=>{const h=await harness();const old=(await h.workspace.read(actor.orgId)).documents.find(d=>d.rule?.type==='INSULT')!;
  const future={...old,id:'synthetic-future',revision:old.revision+1,contentHash:digest(old.markdown+'\nFuture fixture'),markdown:old.markdown+'\nFuture fixture',effectiveFrom:new Date(Date.now()+86400000).toISOString()};
  await h.workspace.mutate(actor.orgId,s=>{s.documents.push(future);s.authorityEpoch++;});await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);
  const warnings=(await h.store.read(actor.orgId)).warnings;expect(warnings.some(w=>w.category==='CONDUCT_NEEDS_REVIEW')).toBe(true);expect(warnings.every(w=>!w.evidence.knowledgeSnapshot.some(d=>d.id===future.id))).toBe(true);
 });
 it('rechecks conversation department authorization before committing warnings',async()=>{const h=await harness();h.conversation.departmentIds=['department-A'];h.conversation.provenanceHash=conversationHash(h.conversation);
  const scoped={...actor,permissions:['access','create'] as Actor['permissions']};h.resolve.mockResolvedValueOnce(scoped).mockResolvedValueOnce({...scoped,departmentIds:[]});await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);
  const state=await h.store.read(actor.orgId);expect(state.jobs[0]).toMatchObject({state:'DEAD',error:'MONITORING_SCOPE_REVOKED'});expect(state.warnings).toEqual([]);
 });
 it('evidence tampering is detected and source snapshot stays immutable',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);const w=(await h.store.read(actor.orgId)).warnings[0]!;expect(warningEvidenceValid(w)).toBe(true);w.evidence.output.summary='tampered';expect(warningEvidenceValid(w)).toBe(false);expect((await h.store.read(actor.orgId)).jobs[0]?.conversation).toEqual(h.conversation);});
 it('SLA scheduler does not invent eligibility and produces unanswered observations only when due',async()=>{const h=await harness(),scheduler=new MonitoringSlaScheduler(h.adapter,h.workspace,h.clock);const c=syntheticConversation(actor.orgId,'unanswered');expect(await scheduler.evaluate(actor,c)).toMatchObject({reason:'NOT_DUE'});h.advance(3600000);await scheduler.evaluate(actor,c);await h.worker.tick(actor.orgId);const warnings=(await h.store.read(actor.orgId)).warnings;expect(warnings.some(w=>w.category==='UNANSWERED_CONVERSATION')).toBe(true);expect(warnings.some(w=>w.category==='SLA_BREACH')).toBe(true);expect(warnings.some(w=>w.category==='CUSTOMER_CARE_OVERDUE')).toBe(false);
  c.coverage='UNKNOWN';expect(await scheduler.evaluate(actor,c)).toMatchObject({reason:'VERIFIED_SLA_CONTEXT_MISSING'});
 });
 it('warning routes enforce tenant/permissions, review version and preserve evidence',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);const app=Fastify();await app.register(async child=>monitoringRoutes(child,{store:h.store,workspace:h.workspace,settings:h.settings,resolve:async(id,orgId)=>({...actor,id,orgId,permissions:id==='reader'?['access']:actor.permissions}),heartbeat:()=>h.worker.heartbeat,authenticate:async req=>{(req as any).user={id:req.headers['x-id']??actor.id,orgId:req.headers['x-org']??actor.orgId};}}));
  try{const prefix='/api/v1/ai-quality-control/monitoring',w=(await h.store.read(actor.orgId)).warnings[0]!;
   expect((await app.inject({url:prefix+'/warnings'})).json().warnings.length).toBeGreaterThan(0);
   expect((await app.inject({url:prefix+'/warnings/'+w.id,headers:{'x-org':'other'}})).statusCode).toBe(404);
   expect((await app.inject({url:prefix+'/health',headers:{'x-id':'reader'}})).statusCode).toBe(403);
   const payload={version:0,status:'ACKNOWLEDGED',reason:'Synthetic follow up'};
   expect((await app.inject({method:'POST',url:prefix+'/warnings/'+w.id+'/review',payload,headers:{'x-id':'reader'}})).statusCode).toBe(403);
   const reviewed=await app.inject({method:'POST',url:prefix+'/warnings/'+w.id+'/review',payload});expect(reviewed.statusCode).toBe(200);expect(reviewed.json().evidenceHash).toBe(w.evidenceHash);expect(reviewed.json().reviews).toHaveLength(1);
   expect((await app.inject({method:'POST',url:prefix+'/warnings/'+w.id+'/review',payload})).statusCode).toBe(409);
  }finally{await app.close();}
 });
 it('Socket.IO adapter isolates tenants, reauthorizes and emits only invalidation IDs',async()=>{const h=await harness();await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);
  const socket=(id:string)=>({id,emit:vi.fn(),disconnect:vi.fn(),data:{},on:vi.fn()});const good=socket('good'),other=socket('other');
  const namespace={sockets:new Map([['good',good],['other',other]]),use:vi.fn(),on:vi.fn(),disconnectSockets:vi.fn(),removeAllListeners:vi.fn()};
  const allowedActor=vi.fn(async(s:any)=>s.id==='good'?actor:{...actor,orgId:'other'});
  const notifications=new MonitoringNotifications({of:()=>namespace} as any,h.store,h.workspace,allowedActor);
  await notifications.flush(actor.orgId);expect(good.emit).toHaveBeenCalled();expect(other.emit).not.toHaveBeenCalled();
  const event=good.emit.mock.calls[0]![1];expect(Object.keys(event).sort()).toEqual(['id','version','warningId']);
  const count=good.emit.mock.calls.length;await notifications.flush(actor.orgId);expect(good.emit.mock.calls.length).toBe(count);
  allowedActor.mockResolvedValue({...actor,permissions:[]});const newSocket=socket('new');namespace.sockets.set('new',newSocket);await notifications.flush(actor.orgId);expect(newSocket.emit).not.toHaveBeenCalled();notifications.close();
 });
 it('never performs outbound network calls in this suite',()=>{expect(()=>fetch('https://api.openai.com/v1/responses')).toThrow('OUTBOUND_DENIED');});
});
describe('monitoring retention purge and storage bounds',()=>{
 const purger:Actor={...actor,permissions:['access','create','edit','approve','delete','view_all']};
 const DAY=86400000;
 async function processed(){
  const h=await harness();await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);
  await h.workspace.mutate(actor.orgId,s=>{s.settings.retentionDays=30;s.settings.retentionApprovedBy=actor.id;});
  return h;
 }
 const close=async(h:Awaited<ReturnType<typeof harness>>,at:number)=>h.store.mutate(actor.orgId,s=>{for(const w of s.warnings){w.status='DISMISSED';w.updatedAt=at;}for(const d of s.deliveries){d.delivered=true;d.createdAt=at;}for(const j of s.jobs)j.updatedAt=at;});
 it('requires delete+view_all, a reason and an APPROVED workspace retention policy',async()=>{
  const h=await harness();const now=Date.now()+40*DAY;
  await expect(purgeMonitoring(h.store,h.workspace,actor,'r',now)).rejects.toThrow('QC_FORBIDDEN');
  await expect(purgeMonitoring(h.store,h.workspace,{...purger,permissions:['access','delete']},'r',now)).rejects.toThrow('QC_FORBIDDEN');
  await expect(purgeMonitoring(h.store,h.workspace,purger,'  ',now)).rejects.toThrow('PURGE_REASON_REQUIRED');
  await expect(purgeMonitoring(h.store,h.workspace,purger,'r',now)).rejects.toThrow('APPROVED_RETENTION_POLICY_REQUIRED');
 });
 it('never purges OPEN warnings or undelivered notifications, and a repeated no-op writes nothing',async()=>{
  const h=await processed();const before=await h.store.read(actor.orgId);
  expect(before.warnings.length).toBeGreaterThan(0);expect(before.warnings.every(w=>w.status==='OPEN')).toBe(true);
  const r=await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge',Date.now()+40*DAY);
  const after=await h.store.read(actor.orgId);
  expect(r).toMatchObject({jobs:1,warnings:0,deliveries:0});
  expect(after.warnings).toEqual(before.warnings);expect(after.deliveries).toEqual(before.deliveries);
  const wsVersion=(await h.workspace.read(actor.orgId)).version;
  expect(await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge',Date.now()+40*DAY)).toEqual({jobs:0,warnings:0,deliveries:0,tombstoneHash:null});
  expect((await h.workspace.read(actor.orgId)).version).toBe(wsVersion);
  expect((await h.workspace.read(actor.orgId)).audits.filter(a=>a.action==='MONITORING_RETENTION_PURGE')).toHaveLength(1);
 });
 it('never purges PENDING/RETRY/PROCESSING jobs even when old',async()=>{
  const h=await harness();await h.adapter.commit(actor,h.conversation,'1');
  await h.workspace.mutate(actor.orgId,s=>{s.settings.retentionDays=30;s.settings.retentionApprovedBy=actor.id;});
  await h.store.mutate(actor.orgId,s=>{s.jobs[0]!.updatedAt=0;});
  expect((await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge')).jobs).toBe(0);
  expect((await h.store.read(actor.orgId)).jobs[0]!.state).toBe('PENDING');
 });
 it('audits first, purges only closed rows older than the cutoff, keeps review history in the tombstone and is idempotent',async()=>{
  const h=await processed();await close(h,Date.now()-60*DAY);
  const before=await h.store.read(actor.orgId);
  const r=await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge qa@example.com');
  expect(r).toMatchObject({jobs:before.jobs.length,warnings:before.warnings.length,deliveries:before.deliveries.length});expect(r.tombstoneHash).toMatch(/^[a-f0-9]{64}$/);
  expect(await h.store.read(actor.orgId)).toEqual({jobs:[],warnings:[],deliveries:[]});
  const entry=(await h.workspace.read(actor.orgId)).audits.find(a=>a.action==='MONITORING_RETENTION_PURGE')!;
  expect(entry.details).toMatchObject({warnings:before.warnings.length,warningIds:before.warnings.map(w=>w.id).sort(),tombstoneHash:r.tombstoneHash});
  expect(String(entry.details.reason)).not.toContain('qa@example.com');
  expect(await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge')).toEqual({jobs:0,warnings:0,deliveries:0,tombstoneHash:null});
 });
 it('keeps rows newer than the cutoff and never touches another tenant',async()=>{
  const h=await processed();await close(h,Date.now()-5*DAY);
  await h.store.mutate('synthetic-org-B',s=>{s.jobs.push({id:'job-b',orgId:'synthetic-org-B',state:'DONE',updatedAt:0} as never);});
  expect(await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge')).toEqual({jobs:0,warnings:0,deliveries:0,tombstoneHash:null});
  expect((await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge',Date.now()+40*DAY)).jobs).toBe(1);
  expect((await h.store.read('synthetic-org-B')).jobs.map(j=>j.id)).toEqual(['job-b']);
 });
 it('a purged job whose warning was retained does not duplicate warnings when the event is replayed',async()=>{
  const h=await processed();await h.store.mutate(actor.orgId,s=>{for(const j of s.jobs)j.updatedAt=0;});
  const warnings=(await h.store.read(actor.orgId)).warnings.length;
  expect((await purgeMonitoring(h.store,h.workspace,purger,'Synthetic purge')).jobs).toBe(1);
  await h.adapter.commit(actor,h.conversation,'1');await h.worker.tick(actor.orgId);
  expect((await h.store.read(actor.orgId)).warnings).toHaveLength(warnings);
 });
 it('health reports capacity, the store rejects growth beyond 5000 jobs atomically, and purge relieves it',async()=>{
  const h=await harness();await h.store.mutate(actor.orgId,s=>{for(let i=0;i<MONITORING_LIMITS.jobs;i++)s.jobs.push({id:'j'+i,orgId:actor.orgId,state:'DONE',updatedAt:0,createdAt:0,attempts:1} as never);});
  expect((await monitoringHealth(h.store,actor.orgId,true,null)).capacity).toMatchObject({used:{jobs:5000},atCapacity:true});
  await expect(h.store.mutate(actor.orgId,s=>{s.jobs.push({id:'overflow',orgId:actor.orgId} as never);})).rejects.toThrow('MONITORING_CAPACITY_REACHED');
  expect((await h.store.read(actor.orgId)).jobs).toHaveLength(5000);
  await h.workspace.mutate(actor.orgId,s=>{s.settings.retentionDays=30;s.settings.retentionApprovedBy=actor.id;});
  expect((await purgeMonitoring(h.store,h.workspace,purger,'Synthetic capacity relief')).jobs).toBe(5000);
  expect((await monitoringHealth(h.store,actor.orgId,true,null)).capacity.atCapacity).toBe(false);
 });
 it('PostgreSQL store deletes removed rows for the locked tenant only and rolls back on failure',async()=>{
  const queries:Array<{sql:string;params?:unknown[]}>=[];let failOn:string|null=null;
  const client={query:vi.fn(async(sql:string,params?:unknown[])=>{queries.push({sql,params});if(failOn&&sql.startsWith(failOn))throw Error('synthetic failure');
   if(sql.startsWith('SELECT payload FROM native_ai_qc_monitoring_job'))return {rows:[{payload:{id:'keep',orgId:'t1'}},{payload:{id:'drop',orgId:'t1'}}]};return {rows:[]};}),release:vi.fn()};
  const store=new PostgresMonitoringRepository({connect:async()=>client} as never);
  await store.mutate('t1',s=>{s.jobs=s.jobs.filter(j=>j.id!=='drop');});
  const del=queries.filter(q=>q.sql.startsWith('DELETE FROM'));
  expect(del.map(q=>q.sql.split(' ')[2])).toEqual(['native_ai_qc_monitoring_job','native_ai_qc_monitoring_warning','native_ai_qc_monitoring_delivery']);
  expect(del[0]!.params).toEqual(['t1',['keep']]);expect(del.every(q=>q.params![0]==='t1'&&q.sql.includes('organization_id=$1'))).toBe(true);
  const lock=queries.findIndex(q=>q.sql.includes('pg_advisory_xact_lock')),firstDelete=queries.findIndex(q=>q.sql.startsWith('DELETE FROM'));expect(lock).toBeGreaterThan(-1);expect(firstDelete).toBeGreaterThan(lock);
  queries.length=0;failOn='DELETE FROM';
  await expect(store.mutate('t1',s=>{s.jobs=[];})).rejects.toThrow('synthetic failure');
  expect(queries.some(q=>q.sql==='ROLLBACK')).toBe(true);expect(queries.some(q=>q.sql==='COMMIT')).toBe(false);expect(client.release).toHaveBeenCalled();
 });
});
