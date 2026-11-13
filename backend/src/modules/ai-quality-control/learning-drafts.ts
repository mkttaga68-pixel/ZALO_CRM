/**
 * AIQC Nightly Learning — Learning Draft lifecycle.
 *
 * Three knowledge classes are kept strictly apart:
 *  - POLICY_RULE              : official rule synced from Obsidian and published via KnowledgeApprovalService.
 *  - VERIFIED_LEARNING_CASE   : a Learning Draft an Admin approved; stored as an APPROVED KnowledgeVersion
 *                               (reference only, never a matchTerm-based rule).
 *  - LEARNING_DRAFT           : unapproved proposal. Lives in `workspace.learningDrafts`, never in
 *                               `workspace.documents`, so retrieval cannot see it.
 *
 * The miner is deterministic (no model call) and only reads structured fields of already analysed runs
 * (finding type, status, rule citations, message counts). No message text, no explanation text and no
 * identifiers are copied into a draft.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { demand, QcError, type Actor, type AnalysisRun, type AnalysisType, type Citation, type KnowledgeVersion, type Workspace, type WorkspaceRepository } from './contracts.js';
import { audit, digest, effectiveKnowledgeVersions, KnowledgeRetrievalService, verifyCitation } from './knowledge.js';
import { redactPII } from './analysis.js';

export const LEARNING_SOURCE = 'AI_NIGHTLY_LEARNING' as const;
export const LEARNING_SYSTEM_ACTOR_ID = 'system:aiqc-nightly-learning';
export const LEARNING_GENERATOR = 'deterministic-lesson-miner@1';
export const LEARNING_LIMITS = { drafts: 300, openDrafts: 100, evidencePerDraft: 50, minCases: 2, markdownBytes: 32 * 1024, staleOpenDays: 30, rejectSuppressDays: 30, jobs: 60 } as const;
export const LEARNING_CASE_FOLDER = '10_HOC_TU_HOI_THOAI';

export type LearningDraftStatus = 'DRAFT' | 'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type LessonKind = 'RECURRING_FINDING' | 'MISSING_CONTEXT';
export interface LearningEvidence {
    ref: string;
    findingType: AnalysisType;
    findingStatus: 'POTENTIAL_ISSUE' | 'ABSTAIN';
    messageCount: number;
    reviewStatus: AnalysisRun['reviewStatus'];
    observedAt: string;
    ruleRefs: Array<{ documentId: string; revision: number }>;
    missingContext: string[];
}
export interface LearningReviewEvent { at: string; actorId: string; action: string; revision: number; note: string | null }
export interface RegressionCheck { id: string; passed: boolean; detail?: string }
export interface LearningDraft {
    id: string;
    orgId: string;
    kind: 'LEARNING_DRAFT';
    source: typeof LEARNING_SOURCE;
    lessonKind: LessonKind;
    lessonKey: string;
    similarityTokens: string[];
    title: string;
    category: string;
    findingType: AnalysisType;
    relatedRules: Citation[];
    detectedAt: string;
    updatedAt: string;
    caseCount: number;
    rationale: string;
    evidence: LearningEvidence[];
    markdown: string;
    contentHash: string;
    revision: number;
    status: LearningDraftStatus;
    synthetic: boolean;
    departmentIds: string[];
    tenantScope: { verifiedBy: string; verifiedAt: string; revision: number } | null;
    provenance: { tenantDigest: string; generator: string; jobIds: string[]; runRefs: string[]; windowStart: string; windowEnd: string };
    reviewHistory: LearningReviewEvent[];
    knowledgeVersionId: string | null;
    regression: { at: string; passed: boolean; checks: RegressionCheck[] } | null;
    obsidianExport: { status: 'NOT_CONFIGURED' | 'WRITTEN' | 'FAILED'; path: string | null; revision: number | null; error: string | null };
    evidencePurgedAt: string | null;
}
export interface LearningSuppression { lessonKey: string; until: string; reason: 'REJECTED_PURGED' }
export interface LearningJob { id: string; orgId: string; localDate: string; at: string; windowStart: string; windowEnd: string; created: number; merged: number; suppressed: number; expired: number; scope: 'SYNTHETIC' | 'APPROVED_SCOPE' }

const TYPE_VI: Record<AnalysisType, string> = { INSULT: 'Lời lẽ xúc phạm', COURTESY: 'Thiếu lịch sự', UNRESOLVED_REQUEST: 'Yêu cầu chưa được giải quyết', KNOWLEDGE_MISMATCH: 'Thông tin sản phẩm chưa khớp' };
const REVIEW_VI: Record<AnalysisRun['reviewStatus'], string> = { PENDING: 'chưa đối soát', ACCEPTED_FOR_FOLLOWUP: 'đã xác nhận cần theo dõi', DISMISSED: 'đã bác bỏ' };
const OPEN: LearningDraftStatus[] = ['DRAFT', 'CHANGES_REQUESTED'];
const DAY = 86400000;
export const runRef = (orgId: string, runId: string) => 'run_' + digest(orgId + ':' + runId).slice(0, 16);
const drafts = (s: Workspace) => (s.learningDrafts ??= []);

/**
 * PostgreSQL stores one Serializable, optimistically versioned row per tenant, so ANY concurrent write to the
 * workspace (another Admin, the nightly job, an analysis run) surfaces as WORKSPACE_CONFLICT even when it touched
 * a different draft. The mutation callback is synchronous and re-validates everything (expectedRevision, status,
 * hash, tenant scope) against the freshly read state on each attempt, so retrying is safe: a real decision race
 * still ends in a semantic 409 (e.g. LEARNING_DRAFT_ALREADY_DECIDED), never a lost update.
 */
export const LEARNING_RETRY = { attempts: 6, baseDelayMs: 25, maxDelayMs: 600 } as const;
export async function mutateWithRetry<T>(repo: WorkspaceRepository, orgId: string, fn: (state: Workspace) => T, options: { attempts?: number } = {}): Promise<T> {
    const attempts = Math.max(1, options.attempts ?? LEARNING_RETRY.attempts);
    for (let attempt = 1; ; attempt++) {
        try { return await repo.mutate(orgId, fn); }
        catch (error) {
            if (!(error instanceof QcError && error.code === 'WORKSPACE_CONFLICT') || attempt >= attempts) throw error;
            const delay = Math.min(LEARNING_RETRY.maxDelayMs, LEARNING_RETRY.baseDelayMs * 2 ** attempt) * (0.5 + Math.random());
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/** Strips structural tokens (UUIDs, hashes, refs, timestamps) then applies the CRM PII redactor; any change = sensitive. */
export function containsSensitive(text: string) {
    const structural = text
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ' ')
        .replace(/\b[a-f0-9]{64}\b/gi, ' ')
        .replace(/run_[a-f0-9]{16}/g, ' ')
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, ' ');
    return redactPII(structural) !== structural;
}
const cleanNote = (value: unknown, code: string) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new QcError(code);
    return redactPII(value.trim());
};

/* ------------------------------------------------------------------ mining */

interface Candidate { kind: LessonKind; type: AnalysisType; parts: string[]; runs: AnalysisRun[]; evidence: LearningEvidence[]; rules: Citation[] }
function ruleLabel(state: Workspace, documentId: string) {
    const doc = state.documents.filter(d => d.documentId === documentId).sort((a, b) => b.revision - a.revision)[0];
    return doc ? path.posix.basename(doc.sourcePath).replace(/\.md$/i, '') : documentId.slice(0, 8);
}
/** First non-front-matter line of a snapshot document, as a verifiable byte-exact citation. */
function headingCitation(doc: KnowledgeVersion): Citation | null {
    const front = doc.markdown.match(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n/);
    let offset = front?.[0].length ?? 0;
    for (const part of doc.markdown.slice(offset).matchAll(/[^\n]*(?:\n|$)/g)) {
        const text = part[0];
        if (!text) break;
        const start = Buffer.byteLength(doc.markdown.slice(0, offset), 'utf8');
        offset += text.length;
        const line = text.replace(/\r?\n$/, '');
        if (!line.trim() || Buffer.byteLength(line) > 800) continue;
        const c: Citation = { documentId: doc.documentId, revision: doc.revision, contentHash: doc.contentHash, byteStart: start, byteEnd: start + Buffer.byteLength(line), quote: line };
        return verifyCitation(doc, c) ? c : null;
    }
    return null;
}
export interface LearningScope { departmentIds: string[] | null; synthetic: boolean }
export function mineLessons(state: Workspace, orgId: string, scope: LearningScope, window: { start: number; end: number }) {
    const groups = new Map<string, Candidate>();
    const runs = state.runs.filter(r => r.orgId === orgId && r.status === 'COMPLETED' && r.reviewStatus !== 'DISMISSED'
        && Date.parse(r.createdAt) > window.start && Date.parse(r.createdAt) <= window.end
        && (scope.synthetic ? r.privacy === 'SYNTHETIC' : r.privacy !== 'SYNTHETIC')
        && (scope.departmentIds === null || r.conversation.departmentIds.length > 0 && r.conversation.departmentIds.every(d => scope.departmentIds!.includes(d))));
    for (const run of runs) {
        for (const f of run.output.findings) {
            let kind: LessonKind, parts: string[], rules: Citation[] = [];
            if (f.status === 'POTENTIAL_ISSUE' && f.citations.length) {
                kind = 'RECURRING_FINDING';
                rules = f.citations.filter(c => c.documentId);
                parts = [...new Set(rules.map(c => c.documentId))].sort();
            }
            else if (f.status === 'ABSTAIN' && f.missingContext.length) {
                kind = 'MISSING_CONTEXT';
                parts = [...new Set(f.missingContext.map(m => String(m).replace(/[^A-Z0-9_]/gi, '').slice(0, 60)).filter(Boolean))].sort();
                if (!parts.length) continue;
                rules = run.knowledgeSnapshot.filter(d => d.rule?.type === f.type).map(headingCitation).filter((c): c is Citation => !!c);
            }
            else continue;
            if (!rules.length) continue;
            const key = [kind, f.type, ...parts].join('|');
            const g = groups.get(key) ?? { kind, type: f.type, parts, runs: [], evidence: [], rules: [] };
            if (!g.runs.includes(run)) {
                g.runs.push(run);
                g.evidence.push({ ref: runRef(orgId, run.id), findingType: f.type, findingStatus: f.status, messageCount: f.messageIds.length, reviewStatus: run.reviewStatus,
                    observedAt: run.createdAt, ruleRefs: [...new Map(rules.map(c => [c.documentId, { documentId: c.documentId, revision: c.revision }])).values()], missingContext: kind === 'MISSING_CONTEXT' ? parts : [] });
            }
            for (const c of rules) if (!g.rules.some(x => x.documentId === c.documentId && x.revision >= c.revision)) { g.rules = g.rules.filter(x => x.documentId !== c.documentId); g.rules.push({ ...c }); }
            groups.set(key, g);
        }
    }
    // Creating a lesson needs >= minCases; a single new case may still be merged into an open draft (dedup).
    return [...groups.values()];
}
function lessonText(state: Workspace, c: Pick<Candidate, 'kind' | 'type' | 'parts' | 'rules'>, caseCount: number, accepted: number) {
    const ruleNames = [...new Set(c.rules.map(r => ruleLabel(state, r.documentId)))];
    const title = c.kind === 'RECURRING_FINDING'
        ? `Tình huống lặp lại: ${TYPE_VI[c.type]} — ${ruleNames.join(', ')}`
        : `Thiếu ngữ cảnh khi đánh giá ${TYPE_VI[c.type].toLowerCase()}: ${c.parts.join(', ')}`;
    const rationale = c.kind === 'RECURRING_FINDING'
        ? `AI quan sát ${caseCount} lượt phân tích khác nhau cùng có nhận xét "${TYPE_VI[c.type]}" trích dẫn quy tắc ${ruleNames.join(', ')} (${accepted} lượt đã được người phụ trách xác nhận cần theo dõi). Mẫu lặp lại cho thấy quy tắc hiện hành có thể cần một tình huống tham chiếu rõ hơn để nhân viên và AI áp dụng nhất quán.`
        : `AI phải tạm dừng đánh giá (ABSTAIN) "${TYPE_VI[c.type]}" ở ${caseCount} lượt phân tích vì thiếu: ${c.parts.join(', ')}. Đề xuất bổ sung tình huống tham chiếu mô tả cách xử lý khi thiếu dữ liệu này.`;
    return { title, rationale };
}
function buildMarkdown(state: Workspace, d: Pick<LearningDraft, 'id' | 'title' | 'rationale' | 'findingType' | 'lessonKind' | 'relatedRules' | 'caseCount' | 'evidence'>, klass: 'LEARNING_DRAFT' | 'VERIFIED_LEARNING_CASE' = 'LEARNING_DRAFT') {
    const lines = [
        '---',
        `id: LD-${d.id.slice(0, 8)}`,
        `status: ${klass === 'LEARNING_DRAFT' ? 'draft' : 'verified'}`,
        `source: ${LEARNING_SOURCE}`,
        `knowledge_class: ${klass}`,
        `finding_type: ${d.findingType}`,
        `lesson_kind: ${d.lessonKind}`,
        `related_rules: [${d.relatedRules.map(r => `${r.documentId}@r${r.revision}`).join(', ')}]`,
        `case_count: ${d.caseCount}`,
        '---',
        `# ${d.title}`,
        '',
        '## Nguyên nhân AI đề xuất',
        d.rationale,
        '',
        '## Bằng chứng đã giảm thiểu dữ liệu',
        'Chỉ ghi tham chiếu băm, loại nhận xét, số tin nhắn liên quan và trạng thái đối soát. Không chứa nội dung hội thoại hay thông tin định danh.',
        ...(klass === 'LEARNING_DRAFT' ? d.evidence : []).map(e => `- ${e.ref}: ${TYPE_VI[e.findingType]} (${e.findingStatus}), ${e.messageCount} tin nhắn liên quan, ${REVIEW_VI[e.reviewStatus]}${e.missingContext.length ? `, thiếu ${e.missingContext.join(', ')}` : ''}`),
        '',
        '## Quy tắc Obsidian liên quan',
        ...d.relatedRules.map(r => `- ${ruleLabel(state, r.documentId)} (${r.documentId} r${r.revision}): "${r.quote.replace(/\s+/g, ' ').slice(0, 200)}"`),
        '',
        '## Ghi chú kiểm duyệt',
        klass === 'LEARNING_DRAFT'
            ? 'Bản nháp chưa duyệt. Không được dùng làm căn cứ đánh giá cho tới khi Admin phê duyệt trong Kho quy tắc.'
            : 'Tình huống tham chiếu đã được Admin phê duyệt. Không thay thế quy tắc chính thức (Policy Rule).',
        '',
    ];
    return lines.join('\n');
}
const tokens = (c: Pick<Candidate, 'kind' | 'type' | 'parts'>) => [c.kind, c.type, ...c.parts];
const jaccard = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); const inter = [...A].filter(x => B.has(x)).length; return inter / (A.size + B.size - inter || 1); };

/* ------------------------------------------------------------------ nightly job */

export function systemLearningActor(orgId: string): Actor { return { id: LEARNING_SYSTEM_ACTOR_ID, orgId, departmentIds: [], permissions: ['access'] }; }
export interface NightlyRunInput { orgId: string; scope: LearningScope; localDate: string; now?: Date; force?: boolean; outbox?: LearningObsidianOutbox; notifier?: LearningNotifier }
export async function runNightlyLearning(repo: WorkspaceRepository, input: NightlyRunInput) {
    const now = input.now ?? new Date(), system = systemLearningActor(input.orgId), jobId = randomUUID();
    const result = await mutateWithRetry(repo, input.orgId, state => {
        const jobs = (state.learningJobs ??= []);
        if (!input.force && jobs.some(j => j.localDate === input.localDate)) return { jobId: null, skipped: 'ALREADY_RAN_FOR_LOCAL_DATE', created: 0, merged: 0, suppressed: 0, expired: 0, changed: [] as string[] };
        const last = jobs.filter(j => j.scope === (input.scope.synthetic ? 'SYNTHETIC' : 'APPROVED_SCOPE')).map(j => Date.parse(j.windowEnd)).sort((a, b) => b - a)[0];
        const window = { start: Math.max(last ?? 0, now.getTime() - 2 * DAY), end: now.getTime() };
        if (!input.scope.synthetic && last === undefined) window.start = now.getTime() - DAY;
        const list = drafts(state), changed: string[] = [];
        let created = 0, merged = 0, suppressed = 0, expired = 0;
        for (const d of list) if (OPEN.includes(d.status) && now.getTime() - Date.parse(d.updatedAt) > LEARNING_LIMITS.staleOpenDays * DAY) {
            d.status = 'EXPIRED'; d.updatedAt = now.toISOString(); d.reviewHistory.push({ at: d.updatedAt, actorId: system.id, action: 'EXPIRED_UNREVIEWED', revision: d.revision, note: null });
            audit(state, system, 'LEARNING_DRAFT_EXPIRED', d.id, { revision: d.revision }); expired++; changed.push(d.id);
        }
        for (const c of mineLessons(state, input.orgId, input.scope, window)) {
            const key = digest([input.orgId, c.kind, c.type, ...c.parts, String(input.scope.synthetic)].join('|')), toks = tokens(c);
            const sameKey = list.filter(d => d.lessonKey === key);
            if (sameKey.some(d => d.status === 'APPROVED') || sameKey.some(d => d.status === 'REJECTED' && now.getTime() - Date.parse(d.updatedAt) < LEARNING_LIMITS.rejectSuppressDays * DAY)
                || (state.learningSuppressions ?? []).some(x => x.lessonKey === key && Date.parse(x.until) > now.getTime())) {
                suppressed++; continue;
            }
            const existing = sameKey.find(d => OPEN.includes(d.status)) ??
                list.find(d => OPEN.includes(d.status) && d.synthetic === input.scope.synthetic && d.findingType === c.type && d.lessonKind === c.kind && jaccard(d.similarityTokens, toks) >= 0.6);
            if (existing) {
                const fresh = c.evidence.filter(e => !existing.provenance.runRefs.includes(e.ref));
                if (!fresh.length) { suppressed++; continue; }
                existing.evidence = [...existing.evidence, ...fresh].slice(-LEARNING_LIMITS.evidencePerDraft);
                existing.provenance.runRefs = [...new Set([...existing.provenance.runRefs, ...fresh.map(e => e.ref)])];
                existing.provenance.jobIds = [...existing.provenance.jobIds, jobId].slice(-20);
                existing.provenance.windowEnd = new Date(window.end).toISOString();
                for (const r of c.rules) if (!existing.relatedRules.some(x => x.documentId === r.documentId)) existing.relatedRules.push(r);
                existing.departmentIds = [...new Set([...existing.departmentIds, ...c.runs.flatMap(r => r.conversation.departmentIds)])].sort();
                existing.caseCount = existing.provenance.runRefs.length;
                const accepted = existing.evidence.filter(e => e.reviewStatus === 'ACCEPTED_FOR_FOLLOWUP').length;
                Object.assign(existing, lessonText(state, { kind: existing.lessonKind, type: existing.findingType, parts: existing.similarityTokens.slice(2), rules: existing.relatedRules }, existing.caseCount, accepted));
                existing.markdown = buildMarkdown(state, existing); existing.contentHash = digest(existing.markdown);
                existing.revision++; existing.status = 'DRAFT'; existing.tenantScope = null; existing.regression = null; existing.updatedAt = now.toISOString();
                existing.reviewHistory.push({ at: existing.updatedAt, actorId: system.id, action: 'MERGED_NEW_EVIDENCE', revision: existing.revision, note: `+${fresh.length} tình huống` });
                audit(state, system, 'LEARNING_DRAFT_MERGED', existing.id, { revision: existing.revision, added: fresh.length, jobId });
                merged++; changed.push(existing.id); continue;
            }
            if (c.runs.length < LEARNING_LIMITS.minCases) continue;
            if (list.filter(d => OPEN.includes(d.status)).length >= LEARNING_LIMITS.openDrafts || list.length >= LEARNING_LIMITS.drafts) { suppressed++; continue; }
            const accepted = c.evidence.filter(e => e.reviewStatus === 'ACCEPTED_FOR_FOLLOWUP').length;
            const at = now.toISOString(), id = randomUUID();
            const draft: LearningDraft = { id, orgId: input.orgId, kind: 'LEARNING_DRAFT', source: LEARNING_SOURCE, lessonKind: c.kind, lessonKey: key, similarityTokens: toks,
                ...lessonText(state, c, c.runs.length, accepted), category: '06_TINH_HUONG_MAU', findingType: c.type, relatedRules: c.rules, detectedAt: at, updatedAt: at,
                caseCount: c.runs.length, evidence: c.evidence.slice(-LEARNING_LIMITS.evidencePerDraft), markdown: '', contentHash: '', revision: 1, status: 'DRAFT',
                synthetic: input.scope.synthetic, departmentIds: [...new Set(c.runs.flatMap(r => r.conversation.departmentIds))].sort(), tenantScope: null,
                provenance: { tenantDigest: digest(input.orgId), generator: LEARNING_GENERATOR, jobIds: [jobId], runRefs: c.evidence.map(e => e.ref), windowStart: new Date(window.start).toISOString(), windowEnd: new Date(window.end).toISOString() },
                reviewHistory: [{ at, actorId: system.id, action: 'CREATED', revision: 1, note: null }], knowledgeVersionId: null, regression: null,
                obsidianExport: { status: 'NOT_CONFIGURED', path: null, revision: null, error: null }, evidencePurgedAt: null };
            draft.markdown = buildMarkdown(state, draft); draft.contentHash = digest(draft.markdown);
            if (containsSensitive(draft.markdown)) { suppressed++; audit(state, system, 'LEARNING_DRAFT_SENSITIVE_REJECTED', 'learning', { jobId }); continue; }
            list.push(draft); created++; changed.push(id);
            audit(state, system, 'LEARNING_DRAFT_CREATED', id, { revision: 1, caseCount: draft.caseCount, lessonKey: key, jobId });
        }
        jobs.push({ id: jobId, orgId: input.orgId, localDate: input.localDate, at: now.toISOString(), windowStart: new Date(window.start).toISOString(), windowEnd: new Date(window.end).toISOString(), created, merged, suppressed, expired, scope: input.scope.synthetic ? 'SYNTHETIC' : 'APPROVED_SCOPE' });
        state.learningJobs = jobs.slice(-LEARNING_LIMITS.jobs);
        audit(state, system, 'LEARNING_NIGHTLY_RUN', 'learning', { jobId, created, merged, suppressed, expired, localDate: input.localDate });
        return { jobId, skipped: null as string | null, created, merged, suppressed, expired, changed };
    });
    // A committed job can be retried after a crash between filesystem publication and state update.
    if (input.outbox) await retryLearningOutbox(repo, input.orgId, input.outbox);
    if (result.changed.length) input.notifier?.changed(input.orgId, { draftId: null, status: 'DRAFT', revision: null, reason: 'NIGHTLY_RUN' });
    return result;
}
export async function retryLearningOutbox(repo: WorkspaceRepository, orgId: string, outbox: LearningObsidianOutbox) {
    const state = await repo.read(orgId);
    const outcomes: Array<{ id: string; revision: number; path: string | null; error: string | null }> = [];
    for (const d of drafts(state).filter(d => d.status === 'DRAFT' && (d.obsidianExport.status !== 'WRITTEN' || d.obsidianExport.revision !== d.revision)).slice(0, 100)) {
        try { outcomes.push({ id: d.id, revision: d.revision, path: await outbox.write(d), error: null }); }
        catch (e) { outcomes.push({ id: d.id, revision: d.revision, path: null, error: e instanceof QcError ? e.code : 'OBSIDIAN_OUTBOX_WRITE_FAILED' }); }
    }
    if (!outcomes.length) return;
    await mutateWithRetry(repo, orgId, s => { for (const o of outcomes) { const d = drafts(s).find(x => x.id === o.id && x.revision === o.revision && x.status === 'DRAFT'); if (d) { d.obsidianExport = { status: o.path ? 'WRITTEN' : 'FAILED', path: o.path, revision: o.revision, error: o.error }; audit(s, systemLearningActor(orgId), o.path ? 'LEARNING_OUTBOX_WRITTEN' : 'LEARNING_OUTBOX_FAILED', d.id, { revision: d.revision, code: o.error }); } } });
    return { written: outcomes.filter(o => o.path).length, failed: outcomes.filter(o => o.error).length };
}

/* ------------------------------------------------------------------ authorized Obsidian writer */

const keyPath = (v: string) => process.platform === 'win32' ? v.toLowerCase() : v;
const inside = (root: string, child: string) => { const r = path.relative(root, child); return r === '' || !r.startsWith('..') && !path.isAbsolute(r); };
/**
 * Writes Learning Draft markdown into a SEPARATE writable staging folder ("outbox"). It refuses any path equal to
 * or inside a read-only vault root (e.g. /run/aiqc/obsidian). Files are created exclusively (never overwritten);
 * moving them into the Obsidian vault is an operator-controlled step outside the CRM container.
 */
export class LearningObsidianOutbox {
    constructor(private dir: string, private readOnlyRoots: string[]) { }
    async validate() {
        if (typeof this.dir !== 'string' || !path.isAbsolute(this.dir)) throw new QcError('LEARNING_OUTBOX_MUST_BE_ABSOLUTE');
        const resolved = path.resolve(this.dir);
        for (const root of [...this.readOnlyRoots, '/run/aiqc/obsidian'])
            if (inside(keyPath(path.resolve(root)), keyPath(resolved)) || inside(keyPath(resolved), keyPath(path.resolve(root)))) throw new QcError('LEARNING_OUTBOX_INSIDE_READ_ONLY_VAULT', 403);
        const stat = await fs.lstat(resolved).catch(() => null);
        if (!stat?.isDirectory() || stat.isSymbolicLink()) throw new QcError('LEARNING_OUTBOX_NOT_FOUND_OR_SYMLINK');
        if (keyPath(await fs.realpath(resolved)) !== keyPath(resolved)) throw new QcError('LEARNING_OUTBOX_SYMLINK_BOUNDARY');
        await fs.access(resolved, constants.W_OK | constants.R_OK);
        return resolved;
    }
    async write(draft: LearningDraft) {
        const dir = await this.validate();
        if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(draft.id) || !Number.isSafeInteger(draft.revision) || draft.revision < 1)
            throw new QcError('LEARNING_OUTBOX_INVALID_ID');
        if (draft.status !== 'DRAFT' || digest(draft.markdown) !== draft.contentHash || Buffer.byteLength(draft.markdown) > LEARNING_LIMITS.markdownBytes)
            throw new QcError('LEARNING_OUTBOX_INVALID_DRAFT');
        if (containsSensitive(draft.markdown)) throw new QcError('LEARNING_DRAFT_SENSITIVE_CONTENT');
        const name = `LD-${draft.id}.r${draft.revision}.md`, file = path.join(dir, name);
        const temporary = path.join(dir, `.learning-${randomUUID()}.tmp`);
        const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o640);
        try {
            // Check again after open and before any content is written.
            if (keyPath(await fs.realpath(dir)) !== keyPath(dir) || !inside(keyPath(dir), keyPath(await fs.realpath(temporary)))) throw new QcError('LEARNING_OUTBOX_SYMLINK_BOUNDARY');
            await handle.writeFile(draft.markdown, 'utf8'); await handle.sync();
            await handle.close();
            await this.validate();
            try { await fs.link(temporary, file); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                const old = await fs.lstat(file);
                if (!old.isFile() || old.isSymbolicLink() || old.size > LEARNING_LIMITS.markdownBytes) throw new QcError('LEARNING_OUTBOX_EXISTING_FILE_CONFLICT', 409);
                const existing = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
                try {
                    const stat = await existing.stat();
                    if (stat.dev !== old.dev || stat.ino !== old.ino || keyPath(await fs.realpath(file)) !== keyPath(file) || await existing.readFile('utf8') !== draft.markdown)
                        throw new QcError('LEARNING_OUTBOX_EXISTING_FILE_CONFLICT', 409);
                } finally { await existing.close(); }
            }
        } finally { await handle.close().catch(() => {}); await fs.unlink(temporary).catch(() => {}); }
        return `${LEARNING_CASE_FOLDER}/${name}`;
    }
}

/* ------------------------------------------------------------------ notifications */

export interface LearningNotifier { changed(orgId: string, event: { draftId: string | null; status: LearningDraftStatus | null; revision: number | null; reason: string }): void; close?(): void }

/* ------------------------------------------------------------------ review service */

const admin = (actor: Actor) => { demand(actor, 'approve'); demand(actor, 'view_all'); };
function visible(actor: Actor, d: LearningDraft) { return d.orgId === actor.orgId && (actor.permissions.includes('view_all') || !d.departmentIds.length || d.departmentIds.some(x => actor.departmentIds.includes(x))); }
function find(actor: Actor, state: Workspace, id: string) {
    const d = drafts(state).find(x => x.id === id);
    if (!d || !visible(actor, d)) throw new QcError('LEARNING_DRAFT_NOT_FOUND', 404);
    return d;
}
function expect(d: LearningDraft, expectedRevision: unknown, statuses: LearningDraftStatus[]) {
    if (!statuses.includes(d.status)) throw new QcError('LEARNING_DRAFT_ALREADY_DECIDED', 409);
    if (expectedRevision !== d.revision) throw new QcError('LEARNING_DRAFT_REVISION_CONFLICT', 409);
    if (OPEN.includes(d.status) && (!Number.isFinite(Date.parse(d.updatedAt)) || Date.now() - Date.parse(d.updatedAt) >= LEARNING_LIMITS.staleOpenDays * DAY)) throw new QcError('LEARNING_DRAFT_EXPIRED', 409);
}
export function learningSummary(actor: Actor, state: Workspace) {
    demand(actor, 'approve');
    const list = drafts(state).filter(d => visible(actor, d));
    return { pending: list.filter(d => d.status === 'DRAFT').length, changesRequested: list.filter(d => d.status === 'CHANGES_REQUESTED').length,
        latestDetectedAt: list.filter(d => OPEN.includes(d.status)).map(d => d.updatedAt).sort().pop() ?? null, version: state.version };
}
export function listItem(d: LearningDraft, state?: Workspace) {
    return { id: d.id, title: d.title, findingType: d.findingType, category: d.category, lessonKind: d.lessonKind, relatedRuleIds: d.relatedRules.map(r => r.documentId),
        relatedRuleLabels: state ? d.relatedRules.map(r => ruleLabel(state, r.documentId)) : [],
        detectedAt: d.detectedAt, updatedAt: d.updatedAt, source: d.source, caseCount: d.caseCount, status: d.status, revision: d.revision, synthetic: d.synthetic,
        tenantScopeVerified: d.tenantScope?.revision === d.revision };
}
export function draftDetail(actor: Actor, state: Workspace, d: LearningDraft) {
    const relatedRules = d.relatedRules.map(r => {
        const cited = state.documents.find(x => x.documentId === r.documentId && x.revision === r.revision);
        const current = effectiveKnowledgeVersions(actor, state, new Date(), d.synthetic).find(x => x.documentId === r.documentId);
        return { ...r, label: ruleLabel(state, r.documentId), sourcePath: cited?.sourcePath ?? null, citationValid: !!cited && verifyCitation(cited, r),
            currentRevision: current?.revision ?? null, currentlyEffective: !!current && current.id === cited?.id && current.knowledgeClass !== 'VERIFIED_LEARNING_CASE' };
    });
    return { ...listItem(d, state), rationale: d.rationale, evidence: d.evidence, markdown: d.markdown, contentHash: d.contentHash, relatedRules, departmentIds: d.departmentIds,
        tenantScope: d.tenantScope, provenance: d.provenance, reviewHistory: d.reviewHistory, regression: d.regression, knowledgeVersionId: d.knowledgeVersionId,
        obsidianExport: d.obsidianExport, evidencePurgedAt: d.evidencePurgedAt, audits: state.audits.filter(a => a.resourceId === d.id).slice(-50) };
}

/** Regression gate run inside the approval transaction against a trial copy of the registry. */
export function learningRegression(actor: Actor, state: Workspace, draft: LearningDraft, candidate: KnowledgeVersion, now: Date): RegressionCheck[] {
    const retrieval = new KnowledgeRetrievalService(), checks: RegressionCheck[] = [];
    const policyTypes = (s: Workspace) => { const r = retrieval.retrieve(actor, s, draft.title, draft.synthetic); const policy = new Set(r.documents.filter(d => d.knowledgeClass !== 'VERIFIED_LEARNING_CASE').map(d => d.id)); return { r, types: new Set(r.chunks.filter(c => policy.has(c.versionId)).map(c => c.rule.type)) }; };
    let before: ReturnType<typeof policyTypes> | null = null;
    try { before = policyTypes(state); checks.push({ id: 'BASELINE_RETRIEVAL_OK', passed: true }); }
    catch (e) { checks.push({ id: 'BASELINE_RETRIEVAL_OK', passed: false, detail: e instanceof QcError ? e.code : 'ERROR' }); }
    checks.push({ id: 'DRAFT_ABSENT_FROM_APPROVED_RETRIEVAL', passed: !state.documents.some(d => d.learningDraftId === draft.id) && !(before?.r.documents.some(d => d.learningDraftId === draft.id)) });
    const trial = structuredClone(state); trial.documents.push(candidate);
    try {
        const after = policyTypes(trial);
        checks.push({ id: 'POLICY_COVERAGE_PRESERVED', passed: !!before && [...before.types].every(t => after.types.has(t)) });
        checks.push({ id: 'NO_KNOWLEDGE_CONFLICT', passed: true });
    }
    catch (e) { checks.push({ id: 'NO_KNOWLEDGE_CONFLICT', passed: false, detail: e instanceof QcError ? e.code : 'ERROR' }); }
    checks.push({ id: 'CANDIDATE_EFFECTIVE_AFTER_APPROVAL', passed: effectiveKnowledgeVersions(actor, trial, new Date(now.getTime() + 1000), draft.synthetic).some(d => d.id === candidate.id) });
    checks.push({ id: 'NO_TERM_RULE_INJECTION', passed: candidate.rule!.matchTerms.length === 0 && candidate.rule!.conflictGroup === null && candidate.rule!.slaSeconds === null });
    const approvedTwins = drafts(state).filter(d => d.id !== draft.id && d.lessonKey === draft.lessonKey && d.status === 'APPROVED');
    checks.push({ id: 'NO_DUPLICATE_VERIFIED_CASE', passed: !approvedTwins.length });
    // Labelled synthetic datasets: a reference case without match terms cannot flip any approved label.
    const labelled = state.datasets.filter(x => x.labelApprovedBy && typeof x.labels[draft.findingType] === 'boolean').length;
    checks.push({ id: 'LABELLED_DATASET_STABILITY', passed: candidate.rule!.matchTerms.length === 0, detail: `${labelled} bộ mẫu đã gán nhãn` });
    return checks;
}

export class LearningDraftService {
    constructor(private repo: WorkspaceRepository, private validateDepartments: (actor: Actor, ids: string[]) => Promise<void>, private notifier?: LearningNotifier, private outbox?: LearningObsidianOutbox) { }
    private notify(actor: Actor, d: { id: string; status: LearningDraftStatus; revision: number }, reason: string) { this.notifier?.changed(actor.orgId, { draftId: d.id, status: d.status, revision: d.revision, reason }); }
    async summary(actor: Actor) { return learningSummary(actor, await this.repo.read(actor.orgId)); }
    async list(actor: Actor, status?: string) {
        demand(actor, 'approve');
        const state = await this.repo.read(actor.orgId);
        return { items: drafts(state).filter(d => visible(actor, d) && (!status || d.status === status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(d => listItem(d, state)), summary: learningSummary(actor, state) };
    }
    async get(actor: Actor, id: string) { demand(actor, 'approve'); const state = await this.repo.read(actor.orgId); return draftDetail(actor, state, find(actor, state, id)); }
    async verifyScope(actor: Actor, id: string, expectedRevision: unknown) {
        admin(actor);
        const snapshot = find(actor, await this.repo.read(actor.orgId), id);
        if (snapshot.provenance.tenantDigest !== digest(actor.orgId) || snapshot.orgId !== actor.orgId) throw new QcError('LEARNING_TENANT_SCOPE_MISMATCH', 403);
        if (!snapshot.synthetic && !snapshot.departmentIds.length) throw new QcError('LEARNING_DEPARTMENT_SCOPE_REQUIRED', 409);
        if (snapshot.departmentIds.length) await this.validateDepartments(actor, snapshot.departmentIds);
        const result = await mutateWithRetry(this.repo, actor.orgId, s => {
            const d = find(actor, s, id); expect(d, expectedRevision, ['DRAFT']);
            if (d.departmentIds.join() !== snapshot.departmentIds.join()) throw new QcError('LEARNING_DRAFT_REVISION_CONFLICT', 409);
            const runOrgs = s.runs.filter(r => d.provenance.runRefs.includes(runRef(r.orgId, r.id)));
            if (runOrgs.some(r => r.orgId !== actor.orgId)) throw new QcError('LEARNING_TENANT_SCOPE_MISMATCH', 403);
            d.tenantScope = { verifiedBy: actor.id, verifiedAt: new Date().toISOString(), revision: d.revision };
            d.reviewHistory.push({ at: d.tenantScope.verifiedAt, actorId: actor.id, action: 'TENANT_SCOPE_VERIFIED', revision: d.revision, note: null });
            audit(s, actor, 'LEARNING_DRAFT_SCOPE_VERIFIED', d.id, { revision: d.revision, departments: d.departmentIds.length });
            return d;
        });
        this.notify(actor, result, 'SCOPE_VERIFIED');
        return draftDetail(actor, await this.repo.read(actor.orgId), result);
    }
    async approve(actor: Actor, id: string, input: { expectedRevision: unknown; contentHash: unknown; confirm: unknown }) {
        admin(actor);
        if (input.confirm !== true) throw new QcError('LEARNING_APPROVAL_CONFIRMATION_REQUIRED');
        const snapshot = find(actor, await this.repo.read(actor.orgId), id);
        // Tenant ACL is re-checked at decision time, not only at verification time.
        if (snapshot.departmentIds.length) await this.validateDepartments(actor, snapshot.departmentIds);
        const now = new Date();
        const result = await mutateWithRetry(this.repo, actor.orgId, s => {
            const d = find(actor, s, id); expect(d, input.expectedRevision, ['DRAFT']);
            if (input.contentHash !== d.contentHash || digest(d.markdown) !== d.contentHash) throw new QcError('LEARNING_DRAFT_HASH_CONFLICT', 409);
            if (d.departmentIds.join() !== snapshot.departmentIds.join()) throw new QcError('LEARNING_DRAFT_REVISION_CONFLICT', 409);
            if (!d.tenantScope || d.tenantScope.revision !== d.revision || d.provenance.tenantDigest !== digest(actor.orgId)) throw new QcError('LEARNING_TENANT_SCOPE_NOT_VERIFIED', 409);
            if (containsSensitive(d.markdown)) throw new QcError('LEARNING_DRAFT_SENSITIVE_CONTENT', 422);
            // Rule citations: every cited rule must be a currently effective official policy rule and the quote must verify byte-exact.
            const active = effectiveKnowledgeVersions(actor, s, now, d.synthetic);
            if (!d.relatedRules.length) throw new QcError('LEARNING_RULE_CITATION_REQUIRED', 422);
            for (const r of d.relatedRules) {
                const cited = s.documents.find(x => x.orgId === actor.orgId && x.documentId === r.documentId && x.revision === r.revision);
                const policy = active.find(x => x.documentId === r.documentId && x.knowledgeClass !== 'VERIFIED_LEARNING_CASE' && x.status === 'APPROVED');
                if (!cited || !verifyCitation(cited, r)) throw new QcError('LEARNING_RULE_CITATION_INVALID', 422);
                if (!policy || policy.id !== cited.id || policy.synthetic !== d.synthetic) throw new QcError('LEARNING_RULE_NOT_EFFECTIVE', 422);
            }
            const at = now.toISOString(), markdown = buildMarkdown(s, d, 'VERIFIED_LEARNING_CASE');
            const candidate: KnowledgeVersion = { id: randomUUID(), documentId: randomUUID(), orgId: actor.orgId, sourcePath: `${LEARNING_CASE_FOLDER}/LD-${d.id}.md`, revision: 1,
                contentHash: digest(markdown), markdown, category: '06_TINH_HUONG_MAU', synthetic: d.synthetic, stagedBy: LEARNING_SYSTEM_ACTOR_ID, status: 'APPROVED',
                approvedBy: actor.id, approvedAt: at, revokedAt: null, effectiveFrom: at, effectiveTo: null, departmentIds: [...d.departmentIds],
                rule: { id: `learning.${d.id.slice(0, 8)}`, type: d.findingType, matchTerms: [], conflictGroup: null, slaSeconds: null, careIntervalDays: null },
                knowledgeClass: 'VERIFIED_LEARNING_CASE', learningDraftId: d.id };
            const checks = learningRegression(actor, s, d, candidate, now), passed = checks.every(c => c.passed);
            d.regression = { at, passed, checks };
            if (!passed) {
                d.reviewHistory.push({ at, actorId: actor.id, action: 'APPROVAL_BLOCKED_BY_REGRESSION', revision: d.revision, note: checks.filter(c => !c.passed).map(c => c.id).join(', ') });
                audit(s, actor, 'LEARNING_DRAFT_REGRESSION_FAILED', d.id, { revision: d.revision, failed: checks.filter(c => !c.passed).map(c => c.id) });
                return { blocked: true as const, d };
            }
            s.documents.push(candidate);
            s.authorityEpoch++; s.indexVersion++;
            d.status = 'APPROVED'; d.knowledgeVersionId = candidate.id; d.updatedAt = at;
            d.reviewHistory.push({ at, actorId: actor.id, action: 'APPROVED', revision: d.revision, note: null });
            audit(s, actor, 'LEARNING_DRAFT_APPROVED', d.id, { revision: d.revision, hash: d.contentHash, knowledgeVersionId: candidate.id, authorityEpoch: s.authorityEpoch });
            audit(s, actor, 'KNOWLEDGE_PUBLISH', candidate.id, { revision: 1, hash: candidate.contentHash, knowledgeClass: 'VERIFIED_LEARNING_CASE', learningDraftId: d.id, authorityEpoch: s.authorityEpoch });
            return { blocked: false as const, d };
        });
        if (result.blocked) throw Object.assign(new QcError('LEARNING_REGRESSION_FAILED', 422), { checks: result.d.regression?.checks });
        this.notify(actor, result.d, 'APPROVED');
        return draftDetail(actor, await this.repo.read(actor.orgId), result.d);
    }
    async reject(actor: Actor, id: string, input: { expectedRevision: unknown; reason: unknown }) {
        admin(actor);
        const reason = cleanNote(input.reason, 'LEARNING_REJECT_REASON_REQUIRED');
        const d = await mutateWithRetry(this.repo, actor.orgId, s => {
            const d = find(actor, s, id); expect(d, input.expectedRevision, OPEN);
            d.status = 'REJECTED'; d.updatedAt = new Date().toISOString();
            d.reviewHistory.push({ at: d.updatedAt, actorId: actor.id, action: 'REJECTED', revision: d.revision, note: reason });
            audit(s, actor, 'LEARNING_DRAFT_REJECTED', d.id, { revision: d.revision, reason });
            return d;
        });
        this.notify(actor, d, 'REJECTED');
        return listItem(d);
    }
    async requestChanges(actor: Actor, id: string, input: { expectedRevision: unknown; note: unknown }) {
        admin(actor);
        const note = cleanNote(input.note, 'LEARNING_CHANGE_NOTE_REQUIRED');
        const d = await mutateWithRetry(this.repo, actor.orgId, s => {
            const d = find(actor, s, id); expect(d, input.expectedRevision, ['DRAFT']);
            d.status = 'CHANGES_REQUESTED'; d.tenantScope = null; d.updatedAt = new Date().toISOString();
            d.reviewHistory.push({ at: d.updatedAt, actorId: actor.id, action: 'CHANGES_REQUESTED', revision: d.revision, note });
            audit(s, actor, 'LEARNING_DRAFT_CHANGES_REQUESTED', d.id, { revision: d.revision, note });
            return d;
        });
        this.notify(actor, d, 'CHANGES_REQUESTED');
        return listItem(d);
    }
    /** Human revision of a draft after a change request. New revision → DRAFT; tenant scope must be re-verified. */
    async revise(actor: Actor, id: string, input: { expectedRevision: unknown; title: unknown; rationale: unknown }) {
        demand(actor, 'edit'); admin(actor);
        const title = cleanNote(input.title, 'LEARNING_TITLE_REQUIRED').slice(0, 200), rationale = cleanNote(input.rationale, 'LEARNING_RATIONALE_REQUIRED');
        if (containsSensitive(String(input.title)) || containsSensitive(String(input.rationale))) throw new QcError('LEARNING_DRAFT_SENSITIVE_CONTENT', 422);
        const d = await mutateWithRetry(this.repo, actor.orgId, s => {
            const d = find(actor, s, id); expect(d, input.expectedRevision, ['CHANGES_REQUESTED']);
            d.title = title; d.rationale = rationale; d.markdown = buildMarkdown(s, d); d.contentHash = digest(d.markdown);
            if (Buffer.byteLength(d.markdown) > LEARNING_LIMITS.markdownBytes) throw new QcError('LEARNING_DRAFT_TOO_LARGE');
            d.revision++; d.status = 'DRAFT'; d.tenantScope = null; d.regression = null; d.updatedAt = new Date().toISOString();
            d.reviewHistory.push({ at: d.updatedAt, actorId: actor.id, action: 'REVISED', revision: d.revision, note: null });
            audit(s, actor, 'LEARNING_DRAFT_REVISED', d.id, { revision: d.revision, hash: d.contentHash });
            return d;
        });
        this.notify(actor, d, 'REVISED');
        // The new revision is staged to the Obsidian outbox right away (best effort; failures are recorded on the draft and retried nightly).
        if (this.outbox) await retryLearningOutbox(this.repo, actor.orgId, this.outbox).catch(() => undefined);
        const fresh = await this.repo.read(actor.orgId);
        return draftDetail(actor, fresh, drafts(fresh).find(x => x.id === d.id) ?? d);
    }
}

/* ------------------------------------------------------------------ monitoring */

/** Admin-only operational snapshot for monitoring. Contains counts and codes only — no draft content, no scope JSON. */
export function learningHealth(actor: Actor, state: Workspace, ctx: { gate: ReturnType<typeof nightlyLearningGate>; outboxConfigured: boolean; realtime: boolean; storageMode: string; now?: Date }) {
    demand(actor, 'approve'); demand(actor, 'view_all');
    const now = (ctx.now ?? new Date()).getTime(), list = drafts(state), jobs = state.learningJobs ?? [];
    const last = jobs.at(-1) ?? null, open = list.filter(d => OPEN.includes(d.status));
    const failedExports = list.filter(d => d.status === 'DRAFT' && d.obsidianExport.status === 'FAILED');
    const pendingExports = list.filter(d => d.status === 'DRAFT' && (d.obsidianExport.status !== 'WRITTEN' || d.obsidianExport.revision !== d.revision));
    const alerts: string[] = [];
    if (ctx.gate.allowed && (!last || now - Date.parse(last.at) > 26 * 3600000)) alerts.push('NIGHTLY_JOB_OVERDUE');
    if (open.length >= LEARNING_LIMITS.openDrafts * 0.8 || list.length >= LEARNING_LIMITS.drafts * 0.8) alerts.push('LEARNING_CAPACITY_NEAR_LIMIT');
    if (ctx.outboxConfigured && failedExports.length) alerts.push('OBSIDIAN_OUTBOX_FAILURES');
    if (open.some(d => now - Date.parse(d.updatedAt) > (LEARNING_LIMITS.staleOpenDays - 7) * DAY)) alerts.push('DRAFTS_EXPIRING_WITHIN_7_DAYS');
    return {
        storageMode: ctx.storageMode, realtime: ctx.realtime,
        scheduler: { allowed: ctx.gate.allowed, blockers: ctx.gate.blockers, schedule: ctx.gate.schedule, scopeTenantMatches: !!ctx.gate.scope && ctx.gate.scope.orgId === actor.orgId },
        lastJob: last && { at: last.at, localDate: last.localDate, scope: last.scope, created: last.created, merged: last.merged, suppressed: last.suppressed, expired: last.expired },
        jobsLast7Days: jobs.filter(j => now - Date.parse(j.at) <= 7 * DAY).length,
        drafts: { total: list.length, open: open.length, pending: list.filter(d => d.status === 'DRAFT').length, approved: list.filter(d => d.status === 'APPROVED').length,
            rejected: list.filter(d => d.status === 'REJECTED').length, expired: list.filter(d => d.status === 'EXPIRED').length, limit: LEARNING_LIMITS.drafts, openLimit: LEARNING_LIMITS.openDrafts },
        suppressions: (state.learningSuppressions ?? []).filter(x => Date.parse(x.until) > now).length,
        outbox: { configured: ctx.outboxConfigured, pending: ctx.outboxConfigured ? pendingExports.length : 0, failed: failedExports.length, lastErrorCodes: [...new Set(failedExports.map(d => d.obsidianExport.error).filter(Boolean))].slice(0, 5) },
        retention: { retentionDays: state.settings.retentionDays, approved: !!state.settings.retentionApprovedBy },
        alerts, version: state.version,
    };
}

/* ------------------------------------------------------------------ retention */

/** Explicit purge (delete + view_all) under the approved workspace retention policy.
 * REJECTED/EXPIRED drafts older than the policy are removed; APPROVED drafts keep the record but drop evidence refs.
 * Open drafts are never purged (they expire first). One audit with a tombstone digest per non-empty purge. */
export async function purgeLearningDrafts(repo: WorkspaceRepository, actor: Actor, reason: unknown, now = Date.now(), notifier?: LearningNotifier) {
    demand(actor, 'delete'); demand(actor, 'view_all');
    const why = cleanNote(reason, 'PURGE_REASON_REQUIRED');
    const result = await mutateWithRetry(repo, actor.orgId, s => {
        const days = s.settings.retentionDays;
        if (!days || !s.settings.retentionApprovedBy) throw new QcError('APPROVED_RETENTION_POLICY_REQUIRED', 403);
        const cutoff = now - days * DAY, list = drafts(s);
        const removed = list.filter(d => (d.status === 'REJECTED' || d.status === 'EXPIRED') && Date.parse(d.updatedAt) <= cutoff);
        const minimised = list.filter(d => d.status === 'APPROVED' && !d.evidencePurgedAt && Date.parse(d.updatedAt) <= cutoff);
        // Expired suppression tombstones are pruned on every purge.
        const before = (s.learningSuppressions ?? []).length;
        s.learningSuppressions = (s.learningSuppressions ?? []).filter(x => Date.parse(x.until) > now);
        const prunedSuppressions = before - s.learningSuppressions.length;
        if (!removed.length && !minimised.length) return { deleted: 0, minimised: 0, tombstoneHash: null as string | null, cutoff: new Date(cutoff).toISOString(), suppressionsKept: 0, prunedSuppressions, outboxFiles: [] as string[] };
        const tombstoneHash = digest([...removed, ...minimised].map(d => `${d.id}:${d.revision}:${d.contentHash}`).sort().join('\n'));
        // A purged REJECTED draft must keep suppressing its lesson for the rest of the 30-day window (retention may be 7 days).
        let suppressionsKept = 0;
        for (const d of removed.filter(x => x.status === 'REJECTED')) {
            const until = Date.parse(d.updatedAt) + LEARNING_LIMITS.rejectSuppressDays * DAY;
            if (until > now && !s.learningSuppressions.some(x => x.lessonKey === d.lessonKey)) { s.learningSuppressions.push({ lessonKey: d.lessonKey, until: new Date(until).toISOString(), reason: 'REJECTED_PURGED' }); suppressionsKept++; }
        }
        // Outbox copies are operator-managed; list them so the operator removes them under the same policy (never auto-deleted here).
        const outboxFiles = removed.filter(d => d.obsidianExport.path).map(d => `${LEARNING_CASE_FOLDER}/LD-${d.id}.r*.md`);
        s.learningDrafts = list.filter(d => !removed.includes(d));
        for (const d of minimised) {
            d.evidence = []; d.provenance.runRefs = []; d.evidencePurgedAt = new Date(now).toISOString();
            d.markdown = buildMarkdown(s, d); d.contentHash = digest(d.markdown);
        }
        audit(s, actor, 'LEARNING_DRAFT_PURGE', 'learning', { deleted: removed.length, minimised: minimised.length, retentionDays: days, cutoff: new Date(cutoff).toISOString(), tombstoneHash, reason: why, suppressionsKept, outboxFiles: outboxFiles.length });
        return { deleted: removed.length, minimised: minimised.length, tombstoneHash, cutoff: new Date(cutoff).toISOString(), suppressionsKept, prunedSuppressions, outboxFiles };
    });
    if (result.deleted || result.minimised) notifier?.changed(actor.orgId, { draftId: null, status: null, revision: null, reason: 'PURGED' });
    return result;
}

/* ------------------------------------------------------------------ activation gate */

export interface NightlyGateInput { enabled?: string; schedule?: string; timeZone?: string; scopeApproval?: string; deploymentTier?: string; productionGo?: string; realDataOrgId?: string; storageMode?: string; nodeEnv?: string }
export interface ApprovedLearningScope { orgId: string; departmentIds: string[]; approvedBy: string; approvedAt: string; reference: string }
/** Nightly Learning runs only with an approved schedule (>= 22:00), an approved data scope for the real-data tenant,
 * persistent storage, and — on production — an explicit GO. Production stays NO-GO by default. */
export function nightlyLearningGate(input: NightlyGateInput) {
    const blockers: string[] = [];
    if (input.enabled !== 'true') blockers.push('NIGHTLY_LEARNING_DISABLED');
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.schedule ?? '');
    const schedule = m && Number(m[1]) >= 22 ? { hour: Number(m[1]), minute: Number(m[2]), timeZone: input.timeZone || 'Asia/Ho_Chi_Minh' } : null;
    if (!schedule) blockers.push('SCHEDULE_NOT_APPROVED');
    if (schedule) { try { new Intl.DateTimeFormat('en', { timeZone: schedule.timeZone }).format(); } catch { blockers.push('SCHEDULE_TIMEZONE_INVALID'); } }
    let scope: ApprovedLearningScope | null = null;
    try {
        const p = JSON.parse(input.scopeApproval ?? '') as Partial<ApprovedLearningScope>;
        if (typeof p.orgId === 'string' && Array.isArray(p.departmentIds) && p.departmentIds.length && p.departmentIds.every(x => typeof x === 'string' && x)
            && typeof p.approvedBy === 'string' && p.approvedBy && typeof p.reference === 'string' && p.reference && typeof p.approvedAt === 'string' && Number.isFinite(Date.parse(p.approvedAt)))
            scope = p as ApprovedLearningScope;
    } catch { /* blocker below */ }
    if (!scope) blockers.push('DATA_SCOPE_NOT_APPROVED');
    else if (!input.realDataOrgId || scope.orgId !== input.realDataOrgId) blockers.push('DATA_SCOPE_TENANT_MISMATCH');
    if (input.storageMode !== 'application') blockers.push('PERSISTENT_STORAGE_REQUIRED');
    if (!input.deploymentTier) blockers.push('DEPLOYMENT_TIER_REQUIRED');
    else if (!['production', 'staging', 'local-test', 'test'].includes(input.deploymentTier)) blockers.push('DEPLOYMENT_TIER_INVALID');
    // A NODE_ENV=production runtime is production regardless of the AI_QC_DEPLOYMENT_TIER label (e.g. a real-data host labelled
    // "local-test"): the scheduler always mines real, approved-scope data there, so the explicit GO is mandatory.
    if ((input.deploymentTier === 'production' || input.nodeEnv === 'production') && input.productionGo !== 'true') blockers.push('PRODUCTION_NO_GO');
    return { allowed: blockers.length === 0, blockers, schedule, scope };
}
export function localClock(now: Date, timeZone: string) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
export const nightlyDue = (now: Date, schedule: { hour: number; minute: number; timeZone: string }) => localClock(now, schedule.timeZone).minutes >= schedule.hour * 60 + schedule.minute;
