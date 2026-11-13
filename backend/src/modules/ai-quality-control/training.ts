import { randomUUID } from 'node:crypto';
import { ANALYSIS_TYPES, canonicalJson, clone, demand, QcError, type Actor, type AnalysisRun, type Dataset, type ManagerInput, type WorkspaceRepository } from './contracts.js';
import { audit, digest, effectiveKnowledgeVersions, verifyCitation } from './knowledge.js';
import { ConversationAnalyzerService, canReadCurrentRun, redactPII, reserveProviderBudget } from './analysis.js';
import { AIProviderService, validateManagerOutput, type ProviderEnvironment } from './providers.js';
import { importAttestedSample, syntheticConversation } from './synthetic.js';
export function visibleDataset(actor: Actor, dataset: Dataset) { return dataset.orgId === actor.orgId && (dataset.createdBy === actor.id || actor.permissions.includes('view_all')) && (!dataset.conversation.departmentIds.length || actor.permissions.includes('view_all') || dataset.conversation.departmentIds.some(id => actor.departmentIds.includes(id))); }
export class AITrainingCenterService {
    constructor(private repo: WorkspaceRepository, private analyzer: ConversationAnalyzerService) { }
    create(actor: Actor, input: {
        name: string;
        scenario?: string;
        sample?: unknown;
        attestSynthetic?: boolean;
    }) {
        demand(actor, 'create');
        if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 120)
            throw new QcError('INVALID_DATASET_NAME');
        const conversation = input.scenario ? syntheticConversation(actor.orgId, input.scenario) : input.attestSynthetic === true ? importAttestedSample(actor.orgId, input.sample) : null;
        if (!conversation)
            throw new QcError('SYNTHETIC_ATTESTATION_REQUIRED');
        if (conversation.source !== 'SERVER_SYNTHETIC' && conversation.messages.some(m => redactPII(m.text) !== m.text))
            throw new QcError('SAMPLE_CONTAINS_SENSITIVE_DATA');
        return this.repo.mutate(actor.orgId, s => {
            const dataset: Dataset = { id: randomUUID(), orgId: actor.orgId, name: input.name.trim(), conversation, createdBy: actor.id, labelRevision: 0, labels: {}, labelApprovedBy: null, labelHistory: [] };
            s.datasets.push(dataset);
            audit(s, actor, 'DATASET_CREATED', dataset.id, { source: conversation.source });
            return dataset;
        });
    }
    label(actor: Actor, id: string, input: {
        expectedRevision: number;
        labels: Dataset['labels'];
    }) {
        demand(actor, 'approve');
        if (!input.labels || typeof input.labels !== 'object' || Array.isArray(input.labels) || Object.entries(input.labels).some(([key, value]) => !ANALYSIS_TYPES.includes(key as never) || typeof value !== 'boolean'))
            throw new QcError('INVALID_GOLD_LABELS');
        return this.repo.mutate(actor.orgId, s => {
            const d = s.datasets.find(d => d.id === id);
            if (!d || !visibleDataset(actor, d))
                throw new QcError('DATASET_NOT_FOUND', 404);
            if (d.labelRevision !== input.expectedRevision)
                throw new QcError('LABEL_REVISION_CONFLICT', 409);
            d.labelRevision++;
            d.labels = clone(input.labels);
            d.labelApprovedBy = actor.id;
            d.labelHistory.push({ revision: d.labelRevision, labels: clone(d.labels), actorId: actor.id, at: new Date().toISOString() });
            audit(s, actor, 'GOLD_LABEL_APPROVED', id, { revision: d.labelRevision });
            return d;
        });
    }
    async analyze(actor: Actor, id: string, provider?: 'mock' | 'openai' | 'ollama') {
        const s = await this.repo.read(actor.orgId), d = s.datasets.find(d => d.id === id);
        if (!d || !visibleDataset(actor, d))
            throw new QcError('DATASET_NOT_FOUND', 404);
        return this.analyzer.analyze(actor, d.conversation, provider);
    }
    async evaluate(actor: Actor, datasetId: string, runId: string) {
        demand(actor, 'approve');
        return this.repo.mutate(actor.orgId, s => {
            const dataset = s.datasets.find(d => d.id === datasetId), run = s.runs.find(r => r.id === runId);
            if (!dataset || !visibleDataset(actor, dataset) || !run || !canReadCurrentRun(actor, s, run) || run.conversation.id !== dataset.conversation.id)
                throw new QcError('EVALUATION_REFERENCE_NOT_FOUND', 404);
            if (!dataset.labelApprovedBy)
                throw new QcError('APPROVED_GOLD_LABELS_REQUIRED');
            let tp = 0, fp = 0, tn = 0, fn = 0, abstain = 0, unlabeled = 0;
            for (const type of ANALYSIS_TYPES) {
                const label = dataset.labels[type], finding = run.output.findings.find(f => f.type === type);
                if (typeof label !== 'boolean') {
                    unlabeled++;
                    continue;
                }
                if (!finding || finding.status === 'ABSTAIN') {
                    abstain++;
                    continue;
                }
                const predicted = finding.status === 'POTENTIAL_ISSUE';
                if (predicted && label)
                    tp++;
                else if (predicted)
                    fp++;
                else if (label)
                    fn++;
                else
                    tn++;
            }
            const decisive = tp + fp + tn + fn, totalLabeled = decisive + abstain;
            const result = { tp, fp, tn, fn, abstain, unlabeled, decisiveDenominator: decisive, totalLabeled,
                falsePositiveRate: fp + tn ? fp / (fp + tn) : null, falseNegativeRate: fn + tp ? fn / (fn + tp) : null,
                abstainRate: totalLabeled ? abstain / totalLabeled : null, coverage: totalLabeled ? decisive / totalLabeled : null,
                denominatorPolicy: 'FP/FN rates exclude ABSTAIN; abstain and coverage use all labeled cases. Unlabeled cases excluded, never treated as negatives.' };
            const evaluation = { id: randomUUID(), datasetId, labelRevision: dataset.labelRevision, runId, at: new Date().toISOString(), result };
            s.evaluations.push(evaluation);
            audit(s, actor, 'SANDBOX_EVALUATION', evaluation.id, { datasetId, labelRevision: dataset.labelRevision, runId });
            return evaluation;
        });
    }
}
export class AIManagerAssistantService {
    constructor(private repo: WorkspaceRepository, private providers?: AIProviderService, private environment?: ProviderEnvironment) { }
    async ask(actor: Actor, question: string, allowedCrmRunIds: ReadonlySet<string> = new Set(), provider: 'mock' | 'openai' = 'mock') {
        demand(actor, 'access');
        if (typeof question !== 'string' || !question.trim() || question.length > 1000)
            throw new QcError('INVALID_MANAGER_QUESTION');
        const s = await this.repo.read(actor.orgId);
        const terms = question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
        const runs = s.runs.filter(r => canReadCurrentRun(actor, s, r) && (r.conversation.source !== 'CRM' || allowedCrmRunIds.has(r.id))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const selected = runs.map(r => ({ r, score: terms.filter(t => r.output.summary.toLowerCase().includes(t) || r.output.findings.some(f => f.explanation.toLowerCase().includes(t))).length })).sort((a, b) => b.score - a.score).slice(0, 5).map(v => v.r);
        if (!selected.length)
            return { status: 'ABSTAIN', answer: 'Chưa có phân tích được phép truy cập để trả lời.', runReferences: [], citations: [], missingContext: ['ANALYSIS_EVIDENCE_NOT_AVAILABLE'], provider: 'local-evidence-retrieval' };
        if (provider === 'openai') {
            demand(actor, 'create');
            const e = this.environment;
            if (!e?.enabled || !e.realApi || !e.outboundTestApproved || !this.providers)
                throw new QcError('OPENAI_OUTBOUND_NOT_AUTHORIZED', 403);
            const at = new Date().toISOString();
            const active = effectiveKnowledgeVersions(actor, s, new Date(at));
            const grounded = selected.filter(r => r.status === 'COMPLETED' && r.knowledgeSnapshot.length && r.knowledgeSnapshot.every(d => active.some(now => now.id === d.id && now.contentHash === d.contentHash)));
            if (!grounded.length)
                return { status: 'ABSTAIN', answer: 'Chưa có chứng cứ dựa trên quy tắc đang có hiệu lực.', runReferences: [], citations: [], missingContext: ['CURRENT_APPROVED_KNOWLEDGE_MISSING'], provider: 'openai' };
            const syntheticOnly = grounded.every(r => r.conversation.source === 'SERVER_SYNTHETIC');
            if (!syntheticOnly && (!e.realData || !e.realDataOutboundApproved || !s.settings.retentionDays))
                throw new QcError('REAL_DATA_OUTBOUND_NOT_AUTHORIZED', 403);
            const aliases = new Map(grounded.map((r, i) => [`r${i + 1}`, r]));
            const input: ManagerInput = { question: redactPII(question), syntheticOnly, maxOutputTokens: s.settings.maxOutputTokens, evidence: [...aliases].map(([runReference, r]) => ({ runReference, summary: redactPII(r.output.summary), status: r.status, reviewStatus: r.reviewStatus, findings: r.output.findings.map(f => ({ ...f, messageIds: [], explanation: redactPII(f.explanation) })) })) };
            const citations = grounded.flatMap(r => r.output.findings.flatMap(f => f.citations));
            if (citations.some(c => redactPII(c.quote) !== c.quote))
                throw new QcError('SENSITIVE_KNOWLEDGE_REQUIRES_REVIEW');
            const id = randomUUID();
            await reserveProviderBudget(this.repo, actor, id, input);
            const p = this.providers.forSettings({ ...s.settings, provider: 'openai' });
            if (!p.answer)
                throw new QcError('MANAGER_PROVIDER_NOT_SUPPORTED');
            const result = await p.answer(input), output = validateManagerOutput(result.output);
            if (output.runReferences.some(ref => !aliases.has(ref)) || output.citations.some(c => !citations.some(known => canonicalJson(c) === canonicalJson(known)) || !output.runReferences.some(ref => aliases.get(ref)?.knowledgeSnapshot.some(d => verifyCitation(d, c)))))
                throw new QcError('MANAGER_INVENTED_EVIDENCE', 502);
            return this.repo.mutate(actor.orgId, current => {
                const now = new Date().toISOString();
                const stillActive = effectiveKnowledgeVersions(actor, current, new Date(now));
                if (current.authorityEpoch !== s.authorityEpoch || grounded.some(r => !canReadCurrentRun(actor, current, r) || r.knowledgeSnapshot.some(d => !stillActive.some(v => v.id === d.id && v.contentHash === d.contentHash))))
                    throw new QcError('KNOWLEDGE_AUTHORITY_CHANGED', 409);
                const reservation = current.reservations.find(r => r.id === id);
                if (reservation)
                    reservation.tokens = Math.max(reservation.tokens, result.usage.inputTokens + result.usage.outputTokens);
                const runReferences = output.runReferences.map(ref => aliases.get(ref)!.id);
                audit(current, actor, 'MANAGER_ASSISTANT_AI_QUERY', id, { questionHash: digest(input.question), runReferences, usage: result.usage, answerHash: digest(output.answer) });
                return { ...output, runReferences, provider: 'openai', usage: result.usage };
            });
        }
        // Extractive grounded assistant: never invents policy, employee rankings or intent.
        const items = selected.map((r: AnalysisRun) => `${r.id}: ${r.output.summary} (${r.status}; ${r.reviewStatus})`);
        await this.repo.mutate(actor.orgId, state => audit(state, actor, 'MANAGER_ASSISTANT_QUERY', 'assistant', { questionHash: digest(redactPII(question)), runReferences: selected.map(r => r.id) }));
        return { status: 'EVIDENCE_SUMMARY', answer: items.join('\n'), runReferences: selected.map(r => r.id), citations: selected.flatMap(r => r.output.findings.flatMap(f => f.citations)), missingContext: ['Không suy luận ngoài các phân tích đã lưu. Nhận xét cần người đối soát.'], provider: 'local-evidence-retrieval' };
    }
}
