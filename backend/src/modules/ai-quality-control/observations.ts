import type { AnalysisRun } from './contracts.js';

/** Build evidence excerpts and rule identities from verified snapshots, never model text. */
export function structuredObservations(run: AnalysisRun) {
    return run.output.findings.flatMap(f => {
        const rules = f.citations.map(c => run.knowledgeSnapshot.find(d => d.documentId === c.documentId && d.revision === c.revision));
        return (rules.length ? rules : [undefined]).map(doc => ({
            conversation_id: run.conversation.id,
            observation_category: f.type,
            evidence_message_ids: f.messageIds,
            evidence_excerpts: run.conversation.messages.filter(m => f.messageIds.includes(m.id)).map(m => m.text),
            rule_id: doc?.rule?.id ?? null,
            rule_revision: doc?.revision ?? null,
            explanation: f.explanation,
            review_status: run.reviewStatus
        }));
    });
}
