import type { Actor, AnalysisRun, Workspace } from './contracts.js';
import { canReadKnowledgeVersionNow } from './knowledge.js';

export function canObserveDepartmentRun(actor: Actor, state: Workspace, run: AnalysisRun, currentRecipients: string[], now = Date.now()) {
  const meta = run.departmentObservation;
  if (!actor.permissions.includes('access') || run.orgId !== actor.orgId || !meta || !meta.recipientUserIds.includes(actor.id) || !currentRecipients.includes(actor.id)) return false;
  if (!run.manualRetention || !Number.isFinite(Date.parse(run.manualRetention.expiresAt)) || Date.parse(run.manualRetention.expiresAt) <= now) return false;
  return run.knowledgeSnapshot.every(doc => canReadKnowledgeVersionNow(actor, state, doc));
}

export function observationResult(run: AnalysisRun, names: Record<string,string>) {
  const employee = (id: string) => ({ id, name: names[id] || 'Nhân viên chưa có tên' });
  const humanIds = [...new Set(run.conversation.messages.filter(m=>m.role==='HUMAN' && m.attribution==='VERIFIED' && !!m.actorId).map(m=>m.actorId!))];
  return { runId: run.id, conversationId: run.conversation.id, status: run.status, reviewStatus: run.reviewStatus, createdAt: run.createdAt,
    summary: run.output.summary, employees: humanIds.map(employee), missingContext: run.missingContext,
    findings: run.output.findings.map(f=>{
      const evidence = run.conversation.messages.filter(m=>f.messageIds.includes(m.id));
      const citedEmployees = [...new Set(evidence.filter(m=>m.role==='HUMAN'&&m.attribution==='VERIFIED'&&!!m.actorId).map(m=>m.actorId!))];
      return {type:f.type,status:f.status,explanation:f.explanation,missingContext:f.missingContext,employees:citedEmployees.map(employee),
        evidence:evidence.map(m=>({id:m.id,text:m.text,role:m.role,occurredAt:m.occurredAt,employee:m.role==='HUMAN'&&m.attribution==='VERIFIED'&&m.actorId?employee(m.actorId):null})),
        citations:f.citations.map(c=>({documentId:c.documentId,revision:c.revision,quote:c.quote,sourcePath:run.knowledgeSnapshot.find(d=>d.documentId===c.documentId&&d.revision===c.revision)?.sourcePath??''}))};
    }) };
}
