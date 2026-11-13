import type {Actor,Conversation,WorkspaceRepository} from '../contracts.js';
import {clone} from '../contracts.js';
import {effectiveKnowledgeVersions} from '../knowledge.js';
import {conversationHash} from '../synthetic.js';
import {SyntheticMessageAdapter} from './synthetic-message-adapter.js';
/** Separate due-time evaluation; no AI-generated SLA or assumed work calendar. */
export class MonitoringSlaScheduler {
 constructor(private adapter:SyntheticMessageAdapter,private workspace:WorkspaceRepository,private clock=Date.now){}
 async evaluate(actor:Actor,conversation:Conversation){
  const rules=effectiveKnowledgeVersions(actor,await this.workspace.read(actor.orgId),new Date(this.clock()));
  const thresholds=[...new Set(rules.map(d=>d.rule?.slaSeconds).filter((n):n is number=>typeof n==='number'))];
  if(thresholds.length!==1||conversation.coverage!=='VERIFIED'||conversation.assignmentStatus!=='VERIFIED'||!conversation.assignedActorId||!conversation.workIntervals?.length)return {scheduled:false,reason:'VERIFIED_SLA_CONTEXT_MISSING'};
  const tick=Math.floor(this.clock()/60000)*60000;
  const snapshot=clone(conversation);snapshot.observationEndAt=new Date(tick).toISOString();snapshot.provenanceHash=conversationHash(snapshot);
  // Eligibility/working-time denominators are computed by the existing analyzer.
  const lastCustomer=conversation.messages.filter(m=>m.role==='CUSTOMER').at(-1);if(!lastCustomer)return {scheduled:false,reason:'NO_CUSTOMER_REQUEST'};
  const workSeconds=conversation.workIntervals.reduce((sum,i)=>sum+Math.max(0,Math.min(this.clock(),Date.parse(i.end))-Math.max(Date.parse(lastCustomer.occurredAt),Date.parse(i.start)))/1000,0);
  if(workSeconds<thresholds[0]!)return {scheduled:false,reason:'NOT_DUE'};
  return this.adapter.commit(actor,snapshot,'sla-tick-'+Math.floor(this.clock()/60000),'SLA_DUE');
 }
}
