export const MODULE = 'AI_QUALITY_CONTROL';
export const ANALYSIS_TYPES = ['INSULT', 'COURTESY', 'UNRESOLVED_REQUEST', 'KNOWLEDGE_MISMATCH'] as const;
export type AnalysisType = typeof ANALYSIS_TYPES[number];
export type Action = 'access' | 'create' | 'edit' | 'approve' | 'delete' | 'view_all';
export interface Actor {
    id: string;
    orgId: string;
    departmentIds: string[];
    permissions: Action[];
}
export class QcError extends Error {
    constructor(public code: string, public statusCode = 400) { super(code); }
}
export function demand(actor: Actor, action: Action) { if (!actor.permissions.includes('access') || !actor.permissions.includes(action))
    throw new QcError('QC_FORBIDDEN', 403); }
export const clone = <T>(value: T): T => structuredClone(value);
/** Logical JSON hashing must survive PostgreSQL JSONB object-key reordering.
 * Array order and string bytes are preserved; document hashes still use raw UTF-8. */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item);
}
export interface Rule {
    id: string;
    type: AnalysisType;
    matchTerms: string[];
    conflictGroup: string | null;
    slaSeconds: number | null;
    careIntervalDays: number | null;
}
export interface KnowledgeVersion {
    id: string;
    documentId: string;
    orgId: string;
    sourcePath: string;
    revision: number;
    contentHash: string;
    markdown: string;
    category: string;
    synthetic: boolean;
    stagedBy: string;
    status: 'DRAFT' | 'APPROVED' | 'REVOKED' | 'REPLACED';
    approvedBy: string | null;
    approvedAt: string | null;
    revokedAt?: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    departmentIds: string[];
    rule: Rule | null;
    /** Absent = POLICY_RULE (official rule synced from Obsidian). VERIFIED_LEARNING_CASE = approved Learning Draft, reference only. */
    knowledgeClass?: 'POLICY_RULE' | 'VERIFIED_LEARNING_CASE';
    learningDraftId?: string;
    /** Set by the Obsidian sync when the source file is no longer in the vault; cleared when it reappears. Drafts cannot be published while set. */
    sourceMissingAt?: string | null;
}
export interface Citation {
    documentId: string;
    revision: number;
    contentHash: string;
    byteStart: number;
    byteEnd: number;
    quote: string;
}
export interface Message {
    id: string;
    text: string;
    occurredAt: string;
    role: 'CUSTOMER' | 'HUMAN' | 'BOT' | 'SYSTEM' | 'UNKNOWN';
    actorId: string | null;
    attribution: 'VERIFIED' | 'UNKNOWN';
    timestampStatus: 'VERIFIED' | 'UNKNOWN';
}
export interface Conversation {
    id: string;
    orgId: string;
    source: 'SERVER_SYNTHETIC' | 'USER_ATTESTED_SAMPLE' | 'CRM';
    messages: Message[];
    departmentIds: string[];
    coverage: 'VERIFIED' | 'UNKNOWN';
    assignedActorId: string | null;
    assignmentStatus: 'VERIFIED' | 'UNKNOWN';
    workIntervals: Array<{
        start: string;
        end: string;
    }> | null;
    offDayIntervals: Array<{
        start: string;
        end: string;
    }> | null;
    observationEndAt: string;
    provenanceHash: string | null;
}
export interface Finding {
    type: AnalysisType;
    status: 'POTENTIAL_ISSUE' | 'NO_ISSUE_OBSERVED' | 'ABSTAIN';
    messageIds: string[];
    citations: Citation[];
    explanation: string;
    missingContext: string[];
}
export interface ProviderOutput {
    findings: Finding[];
    summary: string;
}
export interface ProviderUsage {
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
    costStatus: 'CALCULATED' | 'UNKNOWN_RATE';
    responseId: string | null;
    model: string;
    providerVersion: string;
}
export interface ProviderResult {
    output: ProviderOutput;
    usage: ProviderUsage;
}
export interface KnowledgeChunk {
    versionId: string;
    rule: Rule;
    citation: Citation;
}
export interface ProviderInput {
    conversation: Conversation;
    knowledge: KnowledgeChunk[];
    maxOutputTokens: number;
    /** Approved examples, never authoritative policy and never valid rule citations. */
    learningReferences?: Array<{ id: string; text: string }>;
}
export interface ManagerInput {
    question: string;
    evidence: Array<{
        runReference: string;
        summary: string;
        status: string;
        reviewStatus: string;
        findings: Finding[];
    }>;
    maxOutputTokens: number;
    syntheticOnly: boolean;
}
export interface ManagerOutput {
    status: 'ANSWER' | 'ABSTAIN';
    answer: string;
    runReferences: string[];
    citations: Citation[];
    missingContext: string[];
}
export interface AIProvider {
    name: 'mock' | 'openai' | 'ollama';
    analyze(input: ProviderInput): Promise<ProviderResult>;
    answer?(input: ManagerInput): Promise<{
        output: ManagerOutput;
        usage: ProviderUsage;
    }>;
}
export interface AnalysisRun {
    departmentObservation?: { departmentId: string; recipientUserIds: string[]; seenBy: string[] };
    manualRetention?: { days: 7; expiresAt: string; approvedBy: string };
    id: string;
    orgId: string;
    createdBy: string;
    createdAt: string;
    conversation: Conversation;
    authorityEpoch: number;
    indexVersion: number;
    knowledgeSnapshot: KnowledgeVersion[];
    output: ProviderOutput;
    usage: ProviderUsage | null;
    provider: 'mock' | 'openai' | 'ollama';
    status: 'COMPLETED' | 'NOT_EVALUABLE' | 'FAILED';
    missingContext: string[];
    reviewStatus: 'PENDING' | 'ACCEPTED_FOR_FOLLOWUP' | 'DISMISSED';
    reviewVersion: number;
    privacy: 'SYNTHETIC' | 'REDACTED';
    snapshotHash: string;
    metrics: ResponseMetrics;
}
export interface ResponseMetrics {
    status: 'AVAILABLE' | 'NOT_AVAILABLE';
    reason: string | null;
    eligibleTurns: number;
    answeredTurns: number;
    unansweredEligibleTurns: number;
    excludedTurns: number;
    exclusions: Record<string, number>;
    firstResponseSeconds: number | null;
    medianSeconds: number | null;
    p90Seconds: number | null;
    responseRate: number | null;
    slaCompliance: number | null;
    denominatorDescription: string;
}
export interface Dataset {
    id: string;
    orgId: string;
    name: string;
    conversation: Conversation;
    createdBy: string;
    labelRevision: number;
    labels: Partial<Record<AnalysisType, boolean>>;
    labelApprovedBy: string | null;
    labelHistory: Array<{
        revision: number;
        labels: Partial<Record<AnalysisType, boolean>>;
        actorId: string;
        at: string;
    }>;
}
export interface Audit {
    id: string;
    orgId: string;
    actorId: string;
    action: string;
    resourceId: string;
    at: string;
    details: Record<string, unknown>;
}
export interface Settings {
    provider: 'mock' | 'openai' | 'ollama';
    model: string;
    vaultPath: string;
    maxOutputTokens: number;
    requestsPerMinute: number;
    dailyTokenBudget: number;
    retentionDays: number | null;
    retentionApprovedBy: string | null;
    inputUsdPerMillion: number | null;
    outputUsdPerMillion: number | null;
}
export interface Workspace {
    version: number;
    authorityEpoch: number;
    indexVersion: number;
    settings: Settings;
    documents: KnowledgeVersion[];
    datasets: Dataset[];
    runs: AnalysisRun[];
    audits: Audit[];
    reservations: Array<{
        id: string;
        actorId: string;
        at: string;
        tokens: number;
    }>;
    evaluations: Array<{
        id: string;
        datasetId: string;
        labelRevision: number;
        runId: string;
        at: string;
        result: unknown;
    }>;
    /** AI Nightly Learning drafts. Separate from `documents`, so an unapproved draft can never reach retrieval. */
    learningDrafts?: import('./learning-drafts.js').LearningDraft[];
    learningJobs?: import('./learning-drafts.js').LearningJob[];
    /** Content-free tombstones (lesson-key digest + expiry) that keep a rejected lesson suppressed after its draft is purged. */
    learningSuppressions?: import('./learning-drafts.js').LearningSuppression[];
}
export function initialWorkspace(): Workspace {
    return {
        version: 0, authorityEpoch: 0, indexVersion: 0,
        settings: { provider: 'mock', model: '', vaultPath: '', maxOutputTokens: 1000, requestsPerMinute: 5, dailyTokenBudget: 20000, retentionDays: null, retentionApprovedBy: null, inputUsdPerMillion: null, outputUsdPerMillion: null },
        documents: [], datasets: [], runs: [], audits: [], reservations: [], evaluations: [],
    };
}
export interface WorkspaceRepository {
    read(orgId: string): Promise<Workspace>;
    mutate<T>(orgId: string, fn: (state: Workspace) => T): Promise<T>;
    /** Optional lightweight read of the committed workspace version (no payload transfer). */
    version?(orgId: string): Promise<number>;
}
export const shaPattern = /^[a-f0-9]{64}$/;
export function iso(value: unknown): string { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new QcError('INVALID_TIMESTAMP'); return new Date(value).toISOString(); }
export function canReadDocument(actor: Actor, doc: KnowledgeVersion) {
    return actor.orgId === doc.orgId &&
        (doc.status !== 'DRAFT' || doc.stagedBy === actor.id || actor.permissions.includes('approve') && actor.permissions.includes('view_all')) &&
        (!doc.departmentIds.length || actor.permissions.includes('view_all') || doc.departmentIds.some(id => actor.departmentIds.includes(id)));
}
export function canReadRun(actor: Actor, run: AnalysisRun) { return run.orgId === actor.orgId && (run.createdBy === actor.id || actor.permissions.includes('view_all')) && run.knowledgeSnapshot.every(d => canReadDocument(actor, d)) && (!run.conversation.departmentIds.length || actor.permissions.includes('view_all') || run.conversation.departmentIds.some(id => actor.departmentIds.includes(id))); }
