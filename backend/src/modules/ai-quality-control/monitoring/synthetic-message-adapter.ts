import {canonicalJson,clone,demand,QcError,type Actor,type Conversation} from '../contracts.js';
import {digest} from '../knowledge.js';
import {conversationHash} from '../synthetic.js';
import {automationEventBus} from '../../automation/engine/event-bus.js';
import type {MonitoringRepository,MonitoringSettings,MonitoringJob} from './contracts.js';
/** Stores the synthetic source-message snapshot atomically WITH its durable job.
 * This is not a hook into the production Message writer. */
export class SyntheticMessageAdapter {
 constructor(private store:MonitoringRepository,private settings:MonitoringSettings,private clock=Date.now){}
 async commit(actor:Actor,conversation:Conversation,messageRevision:string,kind:MonitoringJob['kind']='MESSAGE'){
  if(!this.settings.enabled)return {enabled:false,created:false,id:null};
  demand(actor,'create');
  if(actor.orgId!==conversation.orgId||conversation.source!=='SERVER_SYNTHETIC'||conversation.provenanceHash!==conversationHash(conversation)||!conversation.messages.length||conversation.messages.length>200||conversation.messages.some(m=>m.text.length>4000)||!messageRevision||messageRevision.length>200)throw new QcError('MONITORING_SYNTHETIC_EVENT_INVALID',403);
  const sourceHash=digest(canonicalJson(conversation)),key=digest(canonicalJson([actor.orgId,conversation.id,messageRevision,kind])),id='job-'+key,at=this.clock();
  const result=await this.store.mutate(actor.orgId,s=>{const previous=s.jobs.find(j=>j.key===key);if(previous){if(previous.sourceHash!==sourceHash)throw new QcError('MONITORING_EVENT_REVISION_CONFLICT',409);return {enabled:true,created:false,id:previous.id};}
   s.jobs.push({id,key,orgId:actor.orgId,sourceHash,actor:clone(actor),conversation:clone(conversation),kind,state:'PENDING',attempts:0,generation:0,dueAt:at,leaseUntil:0,createdAt:at,updatedAt:at,error:null,runIds:[]});return {enabled:true,created:true,id};});
  if(result.created)automationEventBus.emit({type:'message_received',orgId:actor.orgId,occurredAt:new Date(at),payload:{syntheticMonitoring:true,jobId:id}});
  return result;
 }
}
