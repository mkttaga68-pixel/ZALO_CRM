import {canonicalJson,demand,QcError,type WorkspaceRepository} from '../contracts.js';
import {canReadCurrentRun,ConversationAnalyzerService} from '../analysis.js';
import {AIProviderService,providerEnvironment} from '../providers.js';
import {digest,effectiveKnowledgeVersions} from '../knowledge.js';
import {conversationHash} from '../synthetic.js';
import {MonitoringQueue} from './queue.js';
import {warningsForRun} from './warning-engine.js';
import type {ResolveActor} from './contracts.js';
export class MonitoringWorker {
 private analyzer:ConversationAnalyzerService;
 heartbeat:number|null=null;
 constructor(readonly queue:MonitoringQueue,private workspace:WorkspaceRepository,private resolve:ResolveActor){const environment=providerEnvironment({AI_QC_ENABLED:'true',AI_QC_REAL_API_ENABLED:'false',AI_QC_REAL_DATA_ENABLED:'false'});this.analyzer=new ConversationAnalyzerService(workspace,new AIProviderService(environment),environment);}
 async tick(orgId:string){if(!this.queue.settings.enabled)return null;this.heartbeat=this.queue.clock();const job=await this.queue.claim(orgId);if(!job)return null;
  try{
   const actor=await this.resolve(job.actor.id,job.orgId);demand(actor,'create');
   if(actor.id!==job.actor.id||actor.orgId!==job.orgId||job.conversation.orgId!==job.orgId||job.conversation.source!=='SERVER_SYNTHETIC'||job.conversation.provenanceHash!==conversationHash(job.conversation)||job.sourceHash!==digest(canonicalJson(job.conversation)))throw new QcError('MONITORING_SOURCE_OR_TENANT_INVALID',403);
   if(job.conversation.departmentIds.length&&!actor.permissions.includes('view_all')&&!job.conversation.departmentIds.some(d=>actor.departmentIds.includes(d)))throw new QcError('MONITORING_SCOPE_REVOKED',403);
   const run=await this.analyzer.analyze(actor,job.conversation,'mock');
   const currentActor=await this.resolve(job.actor.id,job.orgId);demand(currentActor,'create');if(currentActor.orgId!==job.orgId||currentActor.id!==job.actor.id)throw new QcError('MONITORING_AUTHORITY_CHANGED',403);
   const current=await this.workspace.read(job.orgId),active=effectiveKnowledgeVersions(currentActor,current);
   if(!canReadCurrentRun(currentActor,current,run))throw new QcError('MONITORING_SCOPE_REVOKED',403);
   if(current.authorityEpoch!==run.authorityEpoch||run.knowledgeSnapshot.some(d=>!active.some(v=>v.id===d.id&&v.contentHash===d.contentHash)))throw new QcError('MONITORING_KNOWLEDGE_CHANGED',409);
   const warnings=warningsForRun(job,run,this.queue.clock());
   await this.queue.store.mutate(job.orgId,s=>{const found=s.jobs.find(j=>j.id===job.id);this.queue.assertLease(found,job);found!.runIds.push(run.id);
    // The event commits warnings only once even if attempt snapshots were orphaned by a crash.
    if(!s.warnings.some(w=>w.jobId===job.id))for(const warning of warnings){s.warnings.push(warning);s.deliveries.push({id:'delivery-'+warning.id,orgId:job.orgId,warningId:warning.id,createdAt:this.queue.clock(),delivered:false});}
    found!.state='DONE';found!.updatedAt=this.queue.clock();found!.leaseUntil=0;found!.error=null;
   });return {jobId:job.id,warningCount:warnings.length};
  }catch(error){const code=error instanceof QcError?error.code:'MONITORING_PROCESSING_FAILED';await this.queue.fail(job,code,error instanceof QcError&&error.statusCode<500&&error.statusCode!==409&&error.statusCode!==429);return {jobId:job.id,error:code};}
 }
}
