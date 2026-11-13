import {canonicalJson,clone,type AnalysisRun} from '../contracts.js';
import {digest,verifyCitation} from '../knowledge.js';
import type {MonitoringJob,MonitoringWarning,WarningType} from './contracts.js';
export function warningEvidenceValid(w:MonitoringWarning){return w.evidence.orgId===w.orgId&&w.evidence.conversation.id===w.conversationId&&digest(canonicalJson(w.evidence))===w.evidenceHash&&w.evidence.output.findings.every(f=>f.citations.every(c=>w.evidence.knowledgeSnapshot.some(d=>verifyCitation(d,c))));}
export function warningsForRun(job:MonitoringJob,run:AnalysisRun,at:number):MonitoringWarning[]{
 const result:MonitoringWarning[]=[],missing=new Set(run.missingContext);
 const known=run.conversation.coverage==='VERIFIED'&&run.conversation.assignmentStatus==='VERIFIED'&&run.conversation.messages.every(m=>m.role!=='UNKNOWN'&&m.timestampStatus==='VERIFIED'&&(m.role!=='HUMAN'||m.attribution==='VERIFIED'&&!!m.actorId));
 const add=(category:WarningType,messageIds:string[],reasons:string[]=[])=>{
  const ruleKey=run.knowledgeSnapshot.map(d=>[d.documentId,d.revision,d.contentHash]);
  const id='warning-'+digest(canonicalJson([job.id,category,ruleKey]));
  const verified=run.conversation.messages.filter(m=>messageIds.includes(m.id)&&m.role==='HUMAN'&&m.attribution==='VERIFIED'&&m.actorId);
  const employees=[...new Set(verified.map(m=>m.actorId!))];
  result.push({id,orgId:job.orgId,jobId:job.id,conversationId:run.conversation.id,createdBy:job.actor.id,category,employeeId:employees.length===1?employees[0]!:null,messageIds:[...new Set(messageIds)],evidence:clone(run),evidenceHash:digest(canonicalJson(run)),coverage:run.conversation.coverage,missingContext:reasons,createdAt:at,updatedAt:at,status:'OPEN',version:0,reviews:[]});
 };
 if(!known)missing.add('ACTOR_ASSIGNMENT_TIMESTAMP_OR_COVERAGE_UNKNOWN');
 for(const finding of run.output.findings){for(const reason of finding.missingContext)missing.add(reason);
  if(known&&run.status==='COMPLETED'&&finding.status==='POTENTIAL_ISSUE'&&finding.citations.length&&finding.citations.every(c=>run.knowledgeSnapshot.some(d=>verifyCitation(d,c))))add(finding.type==='UNRESOLVED_REQUEST'?'UNRESOLVED_REQUEST':'CONDUCT_NEEDS_REVIEW',finding.messageIds);
 }
 if(known&&run.metrics.status==='AVAILABLE'){
  const ids=run.conversation.messages.filter(m=>m.role==='CUSTOMER').map(m=>m.id);
  if(run.metrics.unansweredEligibleTurns>0)add('UNANSWERED_CONVERSATION',ids);
  if(run.metrics.slaCompliance!==null&&run.metrics.slaCompliance<1)add('SLA_BREACH',ids);
 }else if(run.metrics.reason)missing.add(run.metrics.reason);
 // CRM currently has no authoritative orders/care-history adapter. Never infer overdue care.
 if(missing.size)add('INSUFFICIENT_EVIDENCE',[],[...missing].sort());
 // Multiple conduct findings may share one category: merge their message references.
 return [...new Map(result.map(w=>[w.id,{...w,messageIds:[...new Set(result.filter(v=>v.id===w.id).flatMap(v=>v.messageIds))]}])).values()];
}
