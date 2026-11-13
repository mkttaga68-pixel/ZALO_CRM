import { randomUUID } from 'node:crypto';
import { ANALYSIS_TYPES, canReadDocument, canReadRun, canonicalJson, clone, demand, QcError, type Actor, type AnalysisRun, type Conversation, type Finding, type ProviderInput, type ProviderResult, type Workspace, type WorkspaceRepository } from './contracts.js';
import { audit, digest, effectiveKnowledgeVersions, KnowledgeRetrievalService, verifyCitation } from './knowledge.js';
import { AIProviderService, validateOutput, type ProviderEnvironment } from './providers.js';
import { EmployeeResponseAnalyticsService } from './analytics.js';
import { conversationHash, syntheticConversation } from './synthetic.js';
import { ollamaAdmission } from './ollama-provider.js';
import { consumeManualPreview, extraRedact, hasVerifiedManualConnection, recordVerifiedManualConnection, inputFingerprint, issueManualEgressPermit, issueManualPreview, manualSelection, type ManualSelection } from './manual-real-consent.js';
import {consumeContinuousAuthority} from './continuous-authorization.js';
export function redactPII(text: string) { return text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]').replace(/(?<!\w)(?:\+?84|0)[\d .()-]{8,15}\d(?!\w)/g, '[PHONE]').replace(/\b\d{9,20}\b/g, '[IDENTIFIER]').replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)\b/gi, '[SECRET]').replace(/https?:\/\/[^\s]+/g, '[URL]'); }
export function canReadCurrentRun(actor: Actor, state: Workspace, run: AnalysisRun) {
    if(run.manualRetention&&(!Number.isFinite(Date.parse(run.manualRetention.expiresAt))||Date.parse(run.manualRetention.expiresAt)<=Date.now()))return false;
    return canReadRun(actor, run) && run.knowledgeSnapshot.every(snapshot => {
        const authority = state.documents.filter(d => d.documentId === snapshot.documentId && d.approvedAt).sort((a, b) => b.revision - a.revision)[0];
        return !!authority && canReadDocument(actor, authority);
    });
}
function snapshotHash(run: AnalysisRun) { return digest(canonicalJson({ conversation: run.conversation, authorityEpoch: run.authorityEpoch, indexVersion: run.indexVersion, knowledgeSnapshot: run.knowledgeSnapshot, output: run.output, usage: run.usage, provider: run.provider, createdAt: run.createdAt,...(run.manualRetention?{manualRetention:run.manualRetention}:{}) })); }
const abstain = (reason: string): Finding[] => ANALYSIS_TYPES.map(type => ({ type, status: 'ABSTAIN', messageIds: [], citations: [], explanation: 'Chưa đủ điều kiện để đánh giá; cần người phụ trách đối soát.', missingContext: [reason] }));
function pseudonymize(conversation: Conversation, redactions: string[] = [], preserveCalendar = false) {
    const map = new Map<string, string>(), actors = new Map<string, string>();
    const safe = clone(conversation);
    if (conversation.assignedActorId)
        actors.set(conversation.assignedActorId, 'staff-1');
    safe.id = 'conversation-1';
    safe.orgId = 'tenant';
    safe.departmentIds = [];
    safe.provenanceHash = null;
    safe.workIntervals = null;
    safe.offDayIntervals = null;
    const base = Date.parse(conversation.messages[0]?.occurredAt ?? conversation.observationEndAt), anchor = Date.UTC(2000, 0, 1);
    if (preserveCalendar) {
        const shift = (intervals: Conversation['workIntervals']) => intervals?.map(i => ({ start: new Date(anchor + Date.parse(i.start) - base).toISOString(), end: new Date(anchor + Date.parse(i.end) - base).toISOString() })) ?? null;
        safe.workIntervals = shift(conversation.workIntervals);
        safe.offDayIntervals = shift(conversation.offDayIntervals);
    }
    safe.messages = safe.messages.map((m, index) => {
        const alias = `m${index + 1}`;
        map.set(alias, m.id);
        if (m.actorId && !actors.has(m.actorId))
            actors.set(m.actorId, `staff-${actors.size + 1}`);
        return { ...m, id: alias, text: extraRedact(redactPII(m.text),redactions), actorId: m.actorId ? actors.get(m.actorId)! : null, occurredAt: new Date(anchor + Date.parse(m.occurredAt) - base).toISOString() };
    });
    safe.assignedActorId = safe.assignedActorId ? actors.get(safe.assignedActorId) ?? null : null;
    safe.observationEndAt = new Date(anchor + Date.parse(conversation.observationEndAt) - base).toISOString();
    return { conversation: safe, messageMap: map };
}
export async function reserveProviderBudget(repo: WorkspaceRepository, actor: Actor, id: string, input: unknown) {
    return repo.mutate(actor.orgId, state => {
        const now = new Date(), at = now.toISOString(), day = at.slice(0, 10), tokens = Buffer.byteLength(JSON.stringify(input)) + state.settings.maxOutputTokens + 1024;
        if (tokens > state.settings.dailyTokenBudget)
            throw new QcError('INPUT_TOKEN_BUDGET_EXCEEDED', 429);
        const recent = state.reservations.filter(r => Date.parse(r.at) > now.getTime() - 60000);
        const spent = state.reservations.filter(r => r.at.startsWith(day)).reduce((n, r) => n + r.tokens, 0);
        if (recent.length >= state.settings.requestsPerMinute || spent + tokens > state.settings.dailyTokenBudget)
            throw new QcError('AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED', 429);
        state.reservations = state.reservations.filter(r => r.at.startsWith(day));
        state.reservations.push({ id, actorId: actor.id, at, tokens });
        return tokens;
    });
}
export class ConversationAnalyzerService {
    constructor(private repo: WorkspaceRepository, private providers: AIProviderService, private environment: ProviderEnvironment) { }
    private async reserve(actor: Actor, id: string, input: unknown) {
        return reserveProviderBudget(this.repo, actor, id, input);
    }
    /** Local Ollama is the manual real-data provider once OpenAI is removed. */
    private manualProvider(): 'openai' | 'ollama' { return this.environment.openAiRemoved ? 'ollama' : 'openai'; }
    private manualAccess(actor: Actor, conversation: Conversation, provider: 'openai' | 'ollama' = this.manualProvider()) {
        demand(actor,'create');
        const openaiOk = !!this.environment.manualRealTest && !!this.environment.authorizedOrgId && actor.orgId===this.environment.authorizedOrgId;
        const ollamaOk = !!this.environment.ollamaRealData && !!this.environment.realDataOrgId && actor.orgId===this.environment.realDataOrgId;
        if (!this.environment.manualRetention || !this.environment.realData || !(provider==='openai'?openaiOk:ollamaOk) || conversation.orgId!==actor.orgId || conversation.source!=='CRM') throw new QcError('MANUAL_REAL_TEST_NOT_AUTHORIZED',403);
    }
    async previewManual(actor: Actor, conversation: Conversation, options: Partial<ManualSelection>) {
        const provider=this.manualProvider();this.manualAccess(actor,conversation,provider);
        const selection=manualSelection(options),state=await this.repo.read(actor.orgId),selected={...clone(conversation),messages:conversation.messages.slice(-selection.messageLimit)};
        if (!selected.messages.length) throw new QcError('CONVERSATION_EMPTY',409);
        const mapped=pseudonymize(selected,selection.redactions,provider==='ollama'),knowledge=new KnowledgeRetrievalService().retrieve(actor,state,selected.messages.map(m=>m.text).join('\n'),false);
        const input:ProviderInput={conversation:mapped.conversation,knowledge:knowledge.chunks,maxOutputTokens:state.settings.maxOutputTokens,...(knowledge.references.length ? {learningReferences:knowledge.references.map(d=>({id:d.id,text:d.markdown.slice(0,4000)}))}: {})};
        let keyReady=provider==='ollama'&&!!this.environment.ollamaEnabled;const resource=provider==='ollama'&&keyReady?await ollamaAdmission():null;if(provider==='openai')try{keyReady=hasVerifiedManualConnection(actor.orgId,state.settings.model||this.environment.defaultModel||'',this.environment.apiKey());}catch{ /* Never echo secret-loader errors or values. */ }
        return {...issueManualPreview(actor,conversation,selection,input,state.authorityEpoch),conversation:input.conversation,knowledge:input.knowledge,resourceWarning:resource&&!resource.ok?resource.code:null,freeRamGiB:resource?.freeRamBytes!=null?Math.round(resource.freeRamBytes/1024**3*10)/10:null,blockers:[...(state.settings.retentionDays!==7||!state.settings.retentionApprovedBy?['RETENTION_7_DAYS_REQUIRED']:[]),...(knowledge.chunks.length?[]:['APPROVED_RULES_REQUIRED']),...(keyReady?[]:[provider==='ollama'?'LOCAL_MODEL_UNAVAILABLE':'OPENAI_KEY_NOT_VERIFIED']),...(provider==='openai'&&!(this.environment.realApi&&this.environment.outboundTestApproved&&this.environment.realDataOutboundApproved)?['OPENAI_OUTBOUND_NOT_APPROVED']:[])],model:provider==='ollama'?'qwen3:4b-instruct (local)':state.settings.model||this.environment.defaultModel||'',provider,retentionDays:state.settings.retentionDays,canAnalyze:keyReady&&knowledge.chunks.length>0&&state.settings.retentionDays===7&&!!state.settings.retentionApprovedBy&&(provider==='ollama'||this.environment.realApi&&this.environment.outboundTestApproved&&this.environment.realDataOutboundApproved)};
    }
    async analyze(actor: Actor, conversation: Conversation, providerOverride?: 'mock' | 'openai' | 'ollama', manualPreviewToken?: string, continuousPermit?: object) {
        demand(actor, 'create');
        if (conversation.orgId !== actor.orgId)
            throw new QcError('CONVERSATION_NOT_FOUND', 404);
        if (conversation.messages.length > 200 || conversation.messages.some(m => m.text.length > 4000) || new Set(conversation.messages.map(m => m.id)).size !== conversation.messages.length)
            throw new QcError('INVALID_CONVERSATION_SNAPSHOT');
        if (conversation.source === 'SERVER_SYNTHETIC' && conversation.provenanceHash !== conversationHash(conversation))
            throw new QcError('SYNTHETIC_PROVENANCE_MISMATCH');
        const state = await this.repo.read(actor.orgId), settings = { ...state.settings, provider: providerOverride ?? state.settings.provider };
        const automatic=continuousPermit?await consumeContinuousAuthority(continuousPermit,actor,conversation):null;
        if(automatic){
          if(process.env.AI_QC_CONTINUOUS_LOCAL_ENABLED!=='true'||process.env.AI_QC_DEPLOYMENT_TIER!=='local-test'||settings.provider!=='ollama'||!this.environment.openAiRemoved)throw new QcError('CONTINUOUS_DISABLED',403);
          this.manualAccess(actor,conversation,'ollama');
          const previous=state.runs.find(r=>r.id==='auto-'+automatic.jobId);if(previous)return previous;
        }
        if (settings.provider === 'ollama' && conversation.source !== 'SERVER_SYNTHETIC' && !(conversation.source === 'CRM' && this.environment.ollamaRealData && actor.orgId === this.environment.realDataOrgId)) throw new QcError('OLLAMA_SYNTHETIC_ONLY',403);
        // Transient resource shortage: refuse BEFORE spending the preview token or storing an empty run, so the user can simply retry.
        if (settings.provider === 'ollama' && conversation.source === 'CRM') { const admission = await ollamaAdmission(); if (!admission.ok) throw new QcError(admission.code, 503); }
        if (settings.provider === 'openai' && this.environment.authorizedOrgId && actor.orgId !== this.environment.authorizedOrgId)
            throw new QcError('OPENAI_TENANT_NOT_AUTHORIZED', 403);
        const manual = automatic?{messageLimit:50,redactions:[] as string[],observationEndAt:conversation.observationEndAt,authorityEpoch:state.authorityEpoch,inputHash:''}:settings.provider==='ollama'&&conversation.source==='CRM' ? (()=>{this.manualAccess(actor,conversation,'ollama');return consumeManualPreview(manualPreviewToken,actor,conversation);})() : settings.provider==='openai'&&conversation.source==='CRM' ? (()=>{this.manualAccess(actor,conversation);let verified=false;try{verified=hasVerifiedManualConnection(actor.orgId,settings.model||this.environment.defaultModel||'',this.environment.apiKey());}catch{}if(!verified)throw new QcError('OPENAI_SYNTHETIC_CONNECTION_REQUIRED',403);return consumeManualPreview(manualPreviewToken,actor,conversation);})() : null;
        if(manual){conversation={...clone(conversation),messages:conversation.messages.slice(-manual.messageLimit),observationEndAt:manual.observationEndAt};if(state.settings.retentionDays!==7||!state.settings.retentionApprovedBy)throw new QcError('MANUAL_RETENTION_7_DAYS_REQUIRED',403);}
        const id = automatic?'auto-'+automatic.jobId:randomUUID(), createdAt = new Date().toISOString();
        let reason: string | null = null;
        let retrieved: ReturnType<KnowledgeRetrievalService['retrieve']> = { chunks: [], references: [], documents: [] };
        try {
            retrieved = new KnowledgeRetrievalService().retrieve(actor, state, conversation.messages.map(m => m.text).join('\n'), conversation.source !== 'CRM');
        }
        catch (error) {
            reason = error instanceof QcError ? error.code : 'KNOWLEDGE_UNAVAILABLE';
        }
        if (!retrieved.chunks.length)
            reason ??= 'APPROVED_KNOWLEDGE_NOT_AVAILABLE';
        if (conversation.source === 'CRM' && !manual)
            reason ??= 'MANUAL_PREVIEW_REQUIRED_FOR_REAL_DATA';
        const mapped = pseudonymize(conversation,manual?.redactions ?? [],settings.provider === 'ollama');
        const input: ProviderInput = { conversation: mapped.conversation, knowledge: retrieved.chunks, maxOutputTokens: settings.maxOutputTokens,...(retrieved.references.length ? {learningReferences:retrieved.references.map(d=>({id:d.id,text:d.markdown.slice(0,4000)}))}: {}) };
        if(manual){if(!automatic&&(manual.authorityEpoch!==state.authorityEpoch||manual.inputHash!==inputFingerprint(input)))throw new QcError('MANUAL_PREVIEW_CHANGED',409);Object.assign(input,{_manualPermit:issueManualEgressPermit(input)});}
        let result: ProviderResult | null = null;
        if (!reason)
            try {
                if (settings.provider === 'openai') {
                    if (!this.environment.enabled || !this.environment.realApi || !this.environment.outboundTestApproved)
                        throw new QcError('OPENAI_OUTBOUND_NOT_AUTHORIZED', 403);
                    if (conversation.source !== 'SERVER_SYNTHETIC' && (!this.environment.realData || !this.environment.realDataOutboundApproved || !settings.retentionDays))
                        throw new QcError('REAL_DATA_OUTBOUND_NOT_AUTHORIZED', 403);
                    if (retrieved.chunks.some(c => redactPII(c.citation.quote) !== c.citation.quote))
                        throw new QcError('SENSITIVE_KNOWLEDGE_REQUIRES_REVIEW');
                    await this.reserve(actor, id, input);
                }
                if(automatic){await automatic.validate();await this.reserve(actor,id,input);}
                result = await this.providers.forSettings(settings).analyze(input);
                result.output = validateOutput(result.output);
                const types = new Set(result.output.findings.map(f => f.type));
                if (result.output.findings.length !== ANALYSIS_TYPES.length || types.size !== ANALYSIS_TYPES.length)
                    throw new QcError('MISSING_OR_DUPLICATE_ANALYSIS_TYPE');
                for (const f of result.output.findings) {
                    for (const ref of f.messageIds) {
                        if (!mapped.messageMap.has(ref))
                            throw new QcError('MODEL_INVENTED_MESSAGE_REFERENCE');
                    }
                    f.messageIds = f.messageIds.map(ref => mapped.messageMap.get(ref)!);
                    if(automatic&&f.status==='POTENTIAL_ISSUE'&&!f.messageIds.includes(automatic.messageId))Object.assign(f,{status:'ABSTAIN',missingContext:[...f.missingContext,'NO_NEW_EVIDENCE_FOR_TRIGGER']});
                    for (const citation of f.citations) {
                        const document = retrieved.documents.find(d => d.documentId === citation.documentId && d.revision === citation.revision);
                        if (!document || document.knowledgeClass === 'VERIFIED_LEARNING_CASE' || !verifyCitation(document, citation) || !retrieved.chunks.some(c => c.citation.documentId === citation.documentId && c.citation.byteStart === citation.byteStart && c.citation.byteEnd === citation.byteEnd && c.citation.quote === citation.quote))
                            throw new QcError('MODEL_CITATION_INVALID');
                    }
                    if (f.status !== 'ABSTAIN') {
                        const messages = conversation.messages.filter(m => f.messageIds.includes(m.id));
                        const validAtEvent = f.citations.every(c => {
                            const doc = retrieved.documents.find(d => d.documentId === c.documentId && d.revision === c.revision);
                            return doc && doc.rule?.type === f.type && messages.length > 0 && messages.every(m => m.timestampStatus === 'VERIFIED' && Date.parse(m.occurredAt) >= Date.parse(doc.effectiveFrom!) && (!doc.effectiveTo || Date.parse(m.occurredAt) < Date.parse(doc.effectiveTo)));
                        });
                        if (!validAtEvent)
                            Object.assign(f, { status: 'ABSTAIN', missingContext: [...f.missingContext, 'RULE_NOT_APPLICABLE_AT_EVENT_TIME'] });
                        const attributable = messages.some(m => m.role === 'HUMAN' && m.attribution === 'VERIFIED' && m.actorId);
                        const unresolved = f.type === 'UNRESOLVED_REQUEST' && conversation.assignmentStatus === 'VERIFIED' && conversation.assignedActorId && conversation.coverage === 'VERIFIED' && messages.some(m => m.role === 'CUSTOMER');
                        if (!attributable && !unresolved || messages.some(m => m.role === 'HUMAN' && (m.attribution !== 'VERIFIED' || !m.actorId)))
                            Object.assign(f, { status: 'ABSTAIN', missingContext: [...f.missingContext, 'VERIFIED_HUMAN_ATTRIBUTION_MISSING'] });
                        if (!f.citations.length)
                            throw new QcError('MISSING_RULE_CITATION');
                    }
                }
            }
            catch (error) {
                reason = error instanceof QcError ? error.code : 'PROVIDER_UNAVAILABLE';
                result = null;
            }
        const slaValues = [...new Set(retrieved.documents.filter(d => conversation.messages.every(m => Date.parse(m.occurredAt) >= Date.parse(d.effectiveFrom!) && (!d.effectiveTo || Date.parse(m.occurredAt) < Date.parse(d.effectiveTo)))).map(d => d.rule?.slaSeconds).filter((v): v is number => typeof v === 'number'))];
        const storedConversation = clone(conversation);
        if (conversation.source !== 'SERVER_SYNTHETIC')
            for (const message of storedConversation.messages)
                message.text = extraRedact(redactPII(message.text),manual?.redactions ?? []);
        if(automatic){await automatic.validate();if(reason)throw new QcError(reason,503);}
        return this.repo.mutate(actor.orgId, current => {
            if(automatic){const previous=current.runs.find(r=>r.id===id);if(previous)return previous;}
            const at = new Date().toISOString();
            const active = effectiveKnowledgeVersions(actor, current, new Date(at), conversation.source !== 'CRM');
            if (current.authorityEpoch !== state.authorityEpoch || retrieved.documents.some(d => !active.some(now => now.id === d.id && now.contentHash === d.contentHash)))
                reason = 'KNOWLEDGE_AUTHORITY_CHANGED';
            if(automatic&&reason)throw new QcError(reason,409);
            const output = result && !reason ? result.output : { findings: abstain(reason ?? 'NOT_EVALUABLE'), summary: 'Không thể đánh giá bằng chứng trong điều kiện hiện tại.' };
            const run: AnalysisRun = { id, orgId: actor.orgId, createdBy: actor.id, createdAt, conversation: storedConversation, authorityEpoch: state.authorityEpoch, indexVersion: state.indexVersion,
                knowledgeSnapshot: clone(retrieved.documents), output, usage: result?.usage ?? null, provider: settings.provider, status: reason ? 'NOT_EVALUABLE' : 'COMPLETED', missingContext: reason ? [reason] : [],
                reviewStatus: 'PENDING', reviewVersion: 0, privacy: conversation.source === 'SERVER_SYNTHETIC' ? 'SYNTHETIC' : 'REDACTED', snapshotHash: '', metrics: new EmployeeResponseAnalyticsService().calculate(conversation, slaValues.length === 1 ? slaValues[0]! : null) };
            if(manual)run.manualRetention={days:7,expiresAt:new Date(Date.parse(createdAt)+7*86400000).toISOString(),approvedBy:state.settings.retentionApprovedBy!};
            if(automatic)run.departmentObservation={departmentId:automatic.departmentId,recipientUserIds:automatic.recipientUserIds,seenBy:[]};
            run.snapshotHash = snapshotHash(run);
            current.runs.push(run);
            const reservation = current.reservations.find(r => r.id === id);
            if (reservation && result)
                reservation.tokens = Math.max(reservation.tokens, result.usage.inputTokens + result.usage.outputTokens);
            audit(current, actor, 'ANALYSIS_RECORDED', id, { status: run.status, provider: run.provider, model: run.usage?.model ?? settings.model, usage: run.usage, authorityEpoch: run.authorityEpoch });
            return run;
        });
    }
    async testConnection(actor: Actor) {
        demand(actor, 'edit');
        if (this.environment.authorizedOrgId && actor.orgId !== this.environment.authorizedOrgId)
            throw new QcError('OPENAI_TENANT_NOT_AUTHORIZED', 403);
        if (!this.environment.enabled || !this.environment.realApi || !this.environment.outboundTestApproved)
            throw new QcError('OPENAI_OUTBOUND_NOT_AUTHORIZED', 403);
        const state = await this.repo.read(actor.orgId), id = randomUUID();
        const input: ProviderInput = { conversation: pseudonymize(syntheticConversation(actor.orgId, 'polite')).conversation, knowledge: [], maxOutputTokens: state.settings.maxOutputTokens };
        const keyBefore=this.environment.apiKey();
        await this.reserve(actor, id, input);
        const result = await this.providers.forSettings({ ...state.settings, provider: 'openai' }).analyze(input);
        if(this.environment.manualRealTest){const keyAfter=this.environment.apiKey();if(!keyBefore||keyBefore!==keyAfter)throw new QcError('OPENAI_CREDENTIAL_CHANGED',409);recordVerifiedManualConnection(actor.orgId,result.usage.model,keyBefore);}
        await this.repo.mutate(actor.orgId, s => { const r = s.reservations.find(v => v.id === id); if (r)
            r.tokens = Math.max(r.tokens, result.usage.inputTokens + result.usage.outputTokens); audit(s, actor, 'OPENAI_CONNECTION_TEST', id, { requestedModel: state.settings.model, model: result.usage.model, usage: result.usage, status: 'VERIFIED_SYNTHETIC_REQUEST' }); });
        return { status: 'VERIFIED_SYNTHETIC_REQUEST', usage: result.usage };
    }
}
export class EvidenceReviewService {
    constructor(private repo: WorkspaceRepository) { }
    async get(actor: Actor, id: string) { demand(actor, 'access'); const s = await this.repo.read(actor.orgId), run = s.runs.find(r => r.id === id); if (!run || !canReadCurrentRun(actor, s, run))
        throw new QcError('RUN_NOT_FOUND', 404); return run; }
    async replay(actor: Actor, id: string) { const run = await this.get(actor, id); return { runId: id, hashMatches: run.snapshotHash === snapshotHash(run), citationsValid: run.output.findings.every(f => f.citations.every(c => run.knowledgeSnapshot.some(d => verifyCitation(d, c)))), networkUsed: false, interpretation: 'Historical integrity verification only; revoked documents do not become active again.' }; }
    async review(actor: Actor, id: string, input: {
        expectedVersion: number;
        decision: string;
        reason: string;
    }) {
        demand(actor, 'approve');
        if (!['ACCEPTED_FOR_FOLLOWUP', 'DISMISSED', 'PENDING'].includes(input.decision) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000)
            throw new QcError('INVALID_REVIEW_DECISION');
        return this.repo.mutate(actor.orgId, s => {
            const run = s.runs.find(r => r.id === id);
            if (!run || !canReadCurrentRun(actor, s, run))
                throw new QcError('RUN_NOT_FOUND', 404);
            if (run.reviewVersion !== input.expectedVersion)
                throw new QcError('REVIEW_VERSION_CONFLICT', 409);
            if (run.reviewStatus === 'PENDING' ? input.decision === 'PENDING' : input.decision !== 'PENDING')
                throw new QcError('INVALID_REVIEW_TRANSITION', 409);
            const previous = run.reviewStatus;
            run.reviewStatus = input.decision as AnalysisRun['reviewStatus'];
            run.reviewVersion++;
            audit(s, actor, 'HUMAN_REVIEW', id, { from: previous, to: run.reviewStatus, version: run.reviewVersion, reason: redactPII(input.reason), snapshotHash: run.snapshotHash });
            return run;
        });
    }
}
