/**
 * AIQC Nightly Learning — synthetic-only test suite.
 * No OpenAI, no CRM conversations, no production. Only the deterministic mock provider and server-generated scenarios.
 * Run: node scripts/run-aiqc-learning-tests.cjs  (from repository root)
 */
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { type Actor, type Rule } from '../src/modules/ai-quality-control/contracts.js';
import { MemoryWorkspaceRepository } from '../src/modules/ai-quality-control/repository.js';
import { effectiveKnowledgeVersions, KnowledgeApprovalService, KnowledgeRetrievalService, ObsidianKnowledgeService } from '../src/modules/ai-quality-control/knowledge.js';
import { AIProviderService, providerEnvironment } from '../src/modules/ai-quality-control/providers.js';
import { ConversationAnalyzerService } from '../src/modules/ai-quality-control/analysis.js';
import { AITrainingCenterService } from '../src/modules/ai-quality-control/training.js';
import { aiQualityControlRoutes } from '../src/modules/ai-quality-control/routes.js';
import { containsSensitive, LearningDraftService, LearningObsidianOutbox, mutateWithRetry, nightlyDue, nightlyLearningGate, purgeLearningDrafts, runNightlyLearning, type LearningNotifier } from '../src/modules/ai-quality-control/learning-drafts.js';
import { QcError, type WorkspaceRepository } from '../src/modules/ai-quality-control/contracts.js';
import { registerNightlyLearningScheduler, socketLearningNotifier } from '../src/modules/ai-quality-control/learning-routes.js';

const requireFrontend = createRequire(path.resolve('../frontend/package.json'));
const { io: ioClient } = requireFrontend('socket.io-client') as typeof import('socket.io-client');

const fixture = path.resolve('fixtures/ai-quality-control/vault');
if (!process.env.QC_TEST_ROOT || process.env.AI_QC_REAL_API_ENABLED !== 'false' || process.env.AI_QC_REAL_DATA_ENABLED !== 'false')
    throw new Error('Use node scripts/run-aiqc-learning-tests.cjs from repository root.');

const ALL: Actor['permissions'] = ['access', 'create', 'edit', 'approve', 'delete', 'view_all'];
const adminA: Actor = { id: 'synthetic-admin-A1', orgId: 'synthetic-tenant-A', departmentIds: ['dept-A'], permissions: ALL };
const adminA2: Actor = { ...adminA, id: 'synthetic-admin-A2' };
const viewerA: Actor = { id: 'synthetic-viewer-A', orgId: 'synthetic-tenant-A', departmentIds: ['dept-A'], permissions: ['access', 'create'] };
const approverNoViewAll: Actor = { id: 'synthetic-approver-limited', orgId: 'synthetic-tenant-A', departmentIds: ['dept-A'], permissions: ['access', 'approve'] };
const adminB: Actor = { id: 'synthetic-admin-B', orgId: 'synthetic-tenant-B', departmentIds: ['dept-B'], permissions: ALL };
const actors: Record<string, Actor> = Object.fromEntries([adminA, adminA2, viewerA, approverNoViewAll, adminB].map(a => [a.id, a]));

const env = () => providerEnvironment({ AI_QC_ENABLED: 'true', AI_QC_REAL_API_ENABLED: 'false', AI_QC_REAL_DATA_ENABLED: 'false' });
const rule = (type: Rule['type'], term: string): Rule => ({ id: 'synthetic-' + type, type, matchTerms: term ? [term] : [], conflictGroup: null, slaSeconds: type === 'UNRESOLVED_REQUEST' ? 300 : null, careIntervalDays: null });
const docType = (p: string): Rule['type'] => p.includes('courtesy') ? 'COURTESY' : p.includes('request') ? 'UNRESOLVED_REQUEST' : p.includes('product') ? 'KNOWLEDGE_MISMATCH' : 'INSULT';
const terms: Record<Rule['type'], string> = { INSULT: 'đồ ngu', COURTESY: 'tự đi mà tìm', UNRESOLVED_REQUEST: '', KNOWLEDGE_MISMATCH: 'SYNTHETIC-A miễn phí' };

async function harness() {
    const repo = new MemoryWorkspaceRepository(), vault = new ObsidianKnowledgeService(() => [fixture], fixture), approval = new KnowledgeApprovalService(repo), environment = env();
    const analyzer = new ConversationAnalyzerService(repo, new AIProviderService(environment), environment), training = new AITrainingCenterService(repo, analyzer);
    for (const a of [adminA, adminB]) {
        await vault.sync(a, repo, fixture);
        for (const d of (await repo.read(a.orgId)).documents) {
            const t = docType(d.sourcePath);
            await approval.publish(a, d.id, { hash: d.contentHash, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: null, departmentIds: [], rule: rule(t, terms[t]) });
        }
    }
    const analyze = async (a: Actor, scenario: string, n = 1) => { for (let i = 0; i < n; i++) { const d = await training.create(a, { name: `syn-${scenario}-${i}`, scenario } as never); await training.analyze(a, d.id, 'mock'); } };
    return { repo, environment, analyze };
}
const events: Array<{ orgId: string; event: Parameters<LearningNotifier['changed']>[1] }> = [];
const recorder: LearningNotifier = { changed: (orgId, event) => events.push({ orgId, event }) };
const apps: FastifyInstance[] = [];
afterEach(async () => { events.length = 0; for (const a of apps.splice(0)) await a.close(); });

async function api(h: Awaited<ReturnType<typeof harness>>, extra: { notifier?: LearningNotifier; outbox?: LearningObsidianOutbox; realData?: boolean } = {}) {
    const app = Fastify({ logger: false }); apps.push(app);
    await app.register(aiQualityControlRoutes({ repo: h.repo, environment: { ...h.environment, realData: extra.realData ?? false }, vault: new ObsidianKnowledgeService(() => [fixture], fixture), syntheticVault: fixture, storageMode: 'memory',
        authenticate: async (req, reply) => { if (!actors[String(req.headers['x-actor'])]) return reply.code(401).send({ error: 'UNAUTHORIZED' }); },
        actor: async req => actors[String(req.headers['x-actor'])]!,
        validateDepartments: async (a, ids) => { if (ids.some(id => !a.departmentIds.includes(id) && !id.startsWith(a.orgId === adminA.orgId ? 'dept-A' : 'dept-B'))) throw Object.assign(new (await import('../src/modules/ai-quality-control/contracts.js')).QcError('DEPARTMENT_NOT_IN_TENANT', 403)); },
        learningNotifier: extra.notifier ?? recorder, learningOutbox: extra.outbox }));
    const call = async (a: Actor, method: 'GET' | 'POST', url: string, payload?: unknown) => { const r = await app.inject({ method, url: '/api/v1/ai-quality-control/learning-drafts' + url, headers: { 'x-actor': a.id }, ...(payload ? { payload: payload as object } : {}) }); return { status: r.statusCode, body: r.json() as Record<string, any> }; };
    return { app, call };
}
const nightly = (h: Awaited<ReturnType<typeof harness>>, extra: Partial<Parameters<typeof runNightlyLearning>[1]> = {}) =>
    runNightlyLearning(h.repo, { orgId: adminA.orgId, scope: { departmentIds: null, synthetic: true }, localDate: 'sandbox-' + Math.random(), force: true, notifier: recorder, ...extra });

describe('AIQC Nightly Learning — Learning Draft lifecycle (synthetic)', () => {
    it('AI tạo bài học mới: nightly mines recurring analysed findings into a DRAFT with provenance, never auto-approved', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 3); await h.analyze(adminA, 'polite', 1);
        const r = await nightly(h);
        expect(r.created).toBeGreaterThanOrEqual(1);
        const s = await h.repo.read(adminA.orgId), d = s.learningDrafts!.find(x => x.findingType === 'INSULT' && x.lessonKind === 'RECURRING_FINDING')!;
        expect(d).toBeTruthy();
        expect(d.status).toBe('DRAFT');
        expect(d.source).toBe('AI_NIGHTLY_LEARNING');
        expect(d.caseCount).toBe(3);
        expect(d.tenantScope).toBeNull();
        expect(d.provenance.generator).toBe('deterministic-lesson-miner@1');
        expect(d.provenance.runRefs).toHaveLength(3);
        expect(d.reviewHistory[0]!.action).toBe('CREATED');
        expect(s.audits.some(a => a.action === 'LEARNING_DRAFT_CREATED' && a.resourceId === d.id)).toBe(true);
        expect(s.learningDrafts!.every(x => x.status !== 'APPROVED')).toBe(true);
        expect(events.some(e => e.orgId === adminA.orgId && e.event.reason === 'NIGHTLY_RUN')).toBe(true);
    });

    it('không ghi nguyên văn nội dung khách hàng hay PII vào bản nháp', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2);
        await h.repo.mutate(adminA.orgId, s => { for (const r of s.runs) { r.output.findings.forEach(f => f.explanation = 'Khách Nguyễn Văn A 0912345678 a.b@example.com nói đồ ngu'); r.conversation.messages.forEach(m => m.text += ' 0912345678 a.b@example.com'); } });
        await nightly(h);
        const d = (await h.repo.read(adminA.orgId)).learningDrafts![0]!;
        for (const needle of ['0912345678', 'example.com', 'Nguyễn Văn A', 'Tôi sẽ giải đáp', 'SYNTHETIC-A?']) expect(d.markdown).not.toContain(needle);
        expect(JSON.stringify(d.evidence)).not.toMatch(/0912345678|example\.com/);
        expect(containsSensitive(d.markdown)).toBe(false);
        expect(d.evidence.every(e => /^run_[a-f0-9]{16}$/.test(e.ref))).toBe(true);
    });

    it('bản nháp không lọt vào approved retrieval (trước duyệt, sau từ chối, real-data retrieval)', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const s = await h.repo.read(adminA.orgId);
        expect(s.documents.some(d => d.learningDraftId)).toBe(false);
        expect(effectiveKnowledgeVersions(adminA, s).some(d => d.learningDraftId || d.knowledgeClass === 'VERIFIED_LEARNING_CASE')).toBe(false);
        const r = new KnowledgeRetrievalService().retrieve(adminA, s, s.learningDrafts![0]!.title, true);
        expect(r.chunks.every(c => !c.citation.quote.includes('AI_NIGHTLY_LEARNING'))).toBe(true);
    });

    it('notification badge: summary counts pending drafts; list exposes required columns', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await h.analyze(adminA, 'missing-actor', 2); await nightly(h);
        const { call } = await api(h);
        const sum = await call(adminA, 'GET', '/summary');
        expect(sum.status).toBe(200);
        expect(sum.body.pending).toBeGreaterThanOrEqual(1);
        const list = await call(adminA, 'GET', '');
        const item = list.body.items[0];
        for (const k of ['title', 'relatedRuleIds', 'detectedAt', 'source', 'caseCount', 'status', 'findingType', 'category']) expect(item).toHaveProperty(k);
        expect(item.source).toBe('AI_NIGHTLY_LEARNING');
        expect(item.status).toBe('DRAFT');
        expect(list.body.items.some((i: { lessonKind: string }) => i.lessonKind === 'MISSING_CONTEXT')).toBe(true);
    });

    it('xem chi tiết: rationale, minimised evidence, related Obsidian rules with verified citations, history', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const id = (await call(adminA, 'GET', '')).body.items[0].id;
        const d = (await call(adminA, 'GET', '/' + id)).body;
        expect(d.rationale).toContain('lượt phân tích');
        expect(d.evidence.length).toBe(2);
        expect(d.evidence[0]).not.toHaveProperty('text');
        expect(d.relatedRules.length).toBeGreaterThan(0);
        expect(d.relatedRules.every((r: { citationValid: boolean; currentlyEffective: boolean; sourcePath: string }) => r.citationValid && r.currentlyEffective && r.sourcePath.startsWith('01_QUY_TAC_UNG_XU/'))).toBe(true);
        expect(d.reviewHistory[0].action).toBe('CREATED');
        expect(d.markdown).toContain('status: draft');
    });

    it('phê duyệt đúng tenant: needs scope verification, RBAC, revision, rule citations, regression → VERIFIED_LEARNING_CASE in retrieval corpus', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const d = (await call(adminA, 'GET', '')).body.items[0], detail = (await call(adminA, 'GET', '/' + d.id)).body;
        const noScope = await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: detail.contentHash, confirm: true });
        expect(noScope).toMatchObject({ status: 409, body: { error: 'LEARNING_TENANT_SCOPE_NOT_VERIFIED' } });
        const noConfirm = await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: detail.contentHash });
        expect(noConfirm.body.error).toBe('LEARNING_APPROVAL_CONFIRMATION_REQUIRED');
        expect((await call(adminA, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision })).status).toBe(200);
        const badHash = await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: 'x'.repeat(64), confirm: true });
        expect(badHash).toMatchObject({ status: 409, body: { error: 'LEARNING_DRAFT_HASH_CONFLICT' } });
        const stale = await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision + 5, contentHash: detail.contentHash, confirm: true });
        expect(stale).toMatchObject({ status: 409, body: { error: 'LEARNING_DRAFT_REVISION_CONFLICT' } });
        const ok = await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: detail.contentHash, confirm: true });
        expect(ok.status).toBe(200);
        expect(ok.body.status).toBe('APPROVED');
        expect(ok.body.regression.passed).toBe(true);
        expect(ok.body.regression.checks.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining(['DRAFT_ABSENT_FROM_APPROVED_RETRIEVAL', 'POLICY_COVERAGE_PRESERVED', 'NO_KNOWLEDGE_CONFLICT', 'NO_TERM_RULE_INJECTION']));
        const s = await h.repo.read(adminA.orgId), kv = s.documents.find(x => x.learningDraftId === d.id)!;
        expect(kv).toMatchObject({ status: 'APPROVED', knowledgeClass: 'VERIFIED_LEARNING_CASE', approvedBy: adminA.id, synthetic: true, category: '06_TINH_HUONG_MAU' });
        expect(kv.rule!.matchTerms).toEqual([]);
        expect(kv.markdown).toContain('knowledge_class: VERIFIED_LEARNING_CASE');
        expect(effectiveKnowledgeVersions(adminA, s, new Date(Date.now() + 1000)).some(x => x.id === kv.id)).toBe(true);
        // Real-data retrieval never sees a synthetic case; policy rules keep per-type coverage.
        expect(effectiveKnowledgeVersions(adminA, s, new Date(Date.now() + 1000), false).some(x => x.id === kv.id)).toBe(false);
        const r = new KnowledgeRetrievalService().retrieve(adminA, s, 'đồ ngu', true);
        const insultFirst = r.chunks.find(c => c.rule.type === 'INSULT')!;
        expect(s.documents.find(x => x.id === insultFirst.versionId)!.knowledgeClass).not.toBe('VERIFIED_LEARNING_CASE');
        // Tenant B never sees tenant A's case.
        expect((await h.repo.read(adminB.orgId)).documents.some(x => x.learningDraftId)).toBe(false);
        expect(s.audits.some(a => a.action === 'LEARNING_DRAFT_APPROVED')).toBe(true);
    });

    it('phê duyệt bị chặn khi quy tắc trích dẫn đã bị thu hồi (rule citation check)', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const d = (await call(adminA, 'GET', '')).body.items[0], detail = (await call(adminA, 'GET', '/' + d.id)).body;
        await call(adminA, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision });
        const s = await h.repo.read(adminA.orgId), cited = s.documents.find(x => x.documentId === detail.relatedRules[0].documentId && x.status === 'APPROVED')!;
        await new KnowledgeApprovalService(h.repo).revoke(adminA, cited.id, cited.contentHash);
        const r = await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: detail.contentHash, confirm: true });
        expect(r).toMatchObject({ status: 422, body: { error: 'LEARNING_RULE_NOT_EFFECTIVE' } });
        expect((await h.repo.read(adminA.orgId)).learningDrafts![0]!.status).toBe('DRAFT');
    });

    it('từ chối: lý do bắt buộc, lưu lịch sử, chặn tạo lại bài học trùng trong 30 ngày', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const d = (await call(adminA, 'GET', '')).body.items[0];
        expect((await call(adminA, 'POST', `/${d.id}/reject`, { expectedRevision: d.revision })).body.error).toBe('LEARNING_REJECT_REASON_REQUIRED');
        const r = await call(adminA, 'POST', `/${d.id}/reject`, { expectedRevision: d.revision, reason: 'Trùng quy tắc UX-001, liên hệ 0912345678' });
        expect(r.body.status).toBe('REJECTED');
        const after = (await call(adminA, 'GET', '/' + d.id)).body;
        expect(after.reviewHistory.at(-1)).toMatchObject({ action: 'REJECTED', actorId: adminA.id });
        expect(after.reviewHistory.at(-1).note).not.toContain('0912345678');
        await h.analyze(adminA, 'insult', 2);
        const again = await nightly(h);
        expect(again.created).toBe(0);
        expect(again.suppressed).toBeGreaterThanOrEqual(1);
        expect((await call(adminA, 'GET', '/summary')).body.pending).toBe(0);
    });

    it('yêu cầu sửa → chỉnh sửa tạo revision mới, phải xác minh tenant lại', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const d = (await call(adminA, 'GET', '')).body.items[0];
        await call(adminA, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision });
        const rc = await call(adminA, 'POST', `/${d.id}/request-changes`, { expectedRevision: d.revision, note: 'Làm rõ cách xử lý khi khách trích dẫn lời xúc phạm' });
        expect(rc.body.status).toBe('CHANGES_REQUESTED');
        expect(rc.body.tenantScopeVerified).toBe(false);
        expect((await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: 'x', confirm: true })).body.error).toBe('LEARNING_DRAFT_ALREADY_DECIDED');
        const sensitive = await call(adminA, 'POST', `/${d.id}/revise`, { expectedRevision: d.revision, title: 'Tình huống mới', rationale: 'Gọi khách theo số 0912345678' });
        expect(sensitive.body.error).toBe('LEARNING_DRAFT_SENSITIVE_CONTENT');
        const rv = await call(adminA, 'POST', `/${d.id}/revise`, { expectedRevision: d.revision, title: 'Phân biệt lời xúc phạm trực tiếp và trích dẫn', rationale: 'Bổ sung ví dụ trích dẫn để giảm nhận xét sai.' });
        expect(rv.body).toMatchObject({ status: 'DRAFT', revision: d.revision + 1, tenantScope: null });
        expect(rv.body.markdown).toContain('# Phân biệt lời xúc phạm trực tiếp và trích dẫn');
        expect(rv.body.reviewHistory.map((e: { action: string }) => e.action)).toEqual(['CREATED', 'TENANT_SCOPE_VERIFIED', 'CHANGES_REQUESTED', 'REVISED']);
    });

    it('trùng bài học: lần chạy sau gộp vào bản nháp đang mở thay vì tạo mới; giữ provenance', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2);
        const first = await nightly(h);
        const again = await nightly(h);
        expect(again.created).toBe(0);
        await h.analyze(adminA, 'insult', 1);
        const merged = await nightly(h);
        expect(merged).toMatchObject({ created: 0, merged: 1 });
        const s = await h.repo.read(adminA.orgId), insult = s.learningDrafts!.filter(d => d.findingType === 'INSULT' && d.lessonKind === 'RECURRING_FINDING');
        expect(insult).toHaveLength(1);
        expect(insult[0]).toMatchObject({ caseCount: 3, revision: 2, status: 'DRAFT' });
        expect(insult[0]!.provenance.jobIds).toEqual(expect.arrayContaining([first.jobId, merged.jobId]));
        expect(insult[0]!.reviewHistory.at(-1)!.action).toBe('MERGED_NEW_EVIDENCE');
    });

    it('hai Admin xử lý đồng thời: đúng một quyết định thắng, bên kia nhận 409; cả hai được thông báo', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const d = (await call(adminA, 'GET', '')).body.items[0], detail = (await call(adminA, 'GET', '/' + d.id)).body;
        await call(adminA, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision });
        events.length = 0;
        const [a, b] = await Promise.all([
            call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: detail.contentHash, confirm: true }),
            call(adminA2, 'POST', `/${d.id}/reject`, { expectedRevision: d.revision, reason: 'Không cần thiết' }),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
        expect([a.body.error, b.body.error].filter(Boolean)[0]).toBe('LEARNING_DRAFT_ALREADY_DECIDED');
        const s = await h.repo.read(adminA.orgId);
        expect(s.documents.filter(x => x.learningDraftId === d.id).length).toBe(a.status === 200 ? 1 : 0);
        expect(events.filter(e => e.event.draftId === d.id)).toHaveLength(1);
        expect((await call(adminA2, 'GET', '/summary')).body.pending).toBe(0);
    });

    it('sai quyền: viewer không xem được; approver thiếu view_all không duyệt/xác minh được', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const d = (await call(adminA, 'GET', '')).body.items[0];
        for (const url of ['/summary', '', '/' + d.id]) expect((await call(viewerA, 'GET', url)).status).toBe(403);
        expect((await call(viewerA, 'POST', `/${d.id}/approve`, { expectedRevision: 1, contentHash: 'x', confirm: true })).status).toBe(403);
        expect((await call(approverNoViewAll, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision })).status).toBe(403);
        expect((await call(approverNoViewAll, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: 'x', confirm: true })).status).toBe(403);
        expect((await call(approverNoViewAll, 'POST', '/purge-expired', { reason: 'x' })).status).toBe(403);
        expect((await call(approverNoViewAll, 'POST', '/sandbox/nightly-run', {})).status).toBe(403);
    });

    it('cross-tenant: Admin tenant B không thấy/không duyệt được bản nháp tenant A; bản nháp mỗi tenant tách biệt', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        const d = (await call(adminA, 'GET', '')).body.items[0], detail = (await call(adminA, 'GET', '/' + d.id)).body;
        expect((await call(adminB, 'GET', '')).body.items).toHaveLength(0);
        expect((await call(adminB, 'GET', '/' + d.id)).status).toBe(404);
        expect((await call(adminB, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision })).status).toBe(404);
        expect((await call(adminB, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: detail.contentHash, confirm: true })).status).toBe(404);
        expect((await call(adminB, 'POST', `/${d.id}/reject`, { expectedRevision: d.revision, reason: 'x' })).status).toBe(404);
        // A draft whose provenance was forged into another tenant cannot pass scope verification.
        await h.repo.mutate(adminA.orgId, s => { s.learningDrafts![0]!.provenance.tenantDigest = 'f'.repeat(64); });
        expect((await call(adminA, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision })).body.error).toBe('LEARNING_TENANT_SCOPE_MISMATCH');
        expect(events.every(e => e.orgId === adminA.orgId)).toBe(true);
    });

    it('sandbox trigger bị từ chối khi bật dữ liệu thật (không đọc hội thoại khách hàng thật)', async () => {
        const h = await harness();
        const live = await api(h, { realData: true });
        expect((await live.call(adminA, 'POST', '/sandbox/nightly-run', {})).body.error).toBe('LEARNING_SANDBOX_TRIGGER_DISABLED_WITH_REAL_DATA');
        await h.analyze(adminA, 'insult', 2);
        const sandbox = await api(h);
        const r = await sandbox.call(adminA, 'POST', '/sandbox/nightly-run', {});
        expect(r.status).toBe(200);
        expect(r.body.created).toBeGreaterThanOrEqual(1);
    });

    it('retention/purge: chỉ xóa bản nháp đã từ chối/hết hạn quá hạn lưu; bản đã duyệt chỉ bỏ bằng chứng; có audit tombstone', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await h.analyze(adminA, 'knowledge', 2); await nightly(h);
        const { call } = await api(h);
        expect((await call(adminA, 'POST', '/purge-expired', { reason: 'Định kỳ' })).body.error).toBe('APPROVED_RETENTION_POLICY_REQUIRED');
        await h.repo.mutate(adminA.orgId, s => { s.settings.retentionDays = 30; s.settings.retentionApprovedBy = adminA.id; });
        const items = (await call(adminA, 'GET', '')).body.items as Array<{ id: string; revision: number; findingType: string }>;
        const insult = items.find(i => i.findingType === 'INSULT')!, knowledge = items.find(i => i.findingType === 'KNOWLEDGE_MISMATCH')!;
        await call(adminA, 'POST', `/${insult.id}/reject`, { expectedRevision: insult.revision, reason: 'Không dùng' });
        const det = (await call(adminA, 'GET', '/' + knowledge.id)).body;
        await call(adminA, 'POST', `/${knowledge.id}/verify-scope`, { expectedRevision: knowledge.revision });
        expect((await call(adminA, 'POST', `/${knowledge.id}/approve`, { expectedRevision: knowledge.revision, contentHash: det.contentHash, confirm: true })).status).toBe(200);
        const { purgeLearningDrafts } = await import('../src/modules/ai-quality-control/learning-drafts.js');
        expect((await purgeLearningDrafts(h.repo, adminA, 'Định kỳ')).deleted).toBe(0);
        const future = Date.now() + 31 * 86400000;
        const p = await purgeLearningDrafts(h.repo, adminA, 'Định kỳ', future, recorder);
        expect(p).toMatchObject({ deleted: 1, minimised: 1 });
        expect(p.tombstoneHash).toMatch(/^[a-f0-9]{64}$/);
        const s = await h.repo.read(adminA.orgId);
        expect(s.learningDrafts!.some(d => d.id === insult.id)).toBe(false);
        const kept = s.learningDrafts!.find(d => d.id === knowledge.id)!;
        expect(kept.evidence).toEqual([]);
        expect(kept.evidencePurgedAt).toBeTruthy();
        expect(s.documents.some(d => d.learningDraftId === knowledge.id && d.status === 'APPROVED')).toBe(true);
        expect(s.audits.some(a => a.action === 'LEARNING_DRAFT_PURGE' && a.details.tombstoneHash === p.tombstoneHash)).toBe(true);
        expect(events.some(e => e.event.reason === 'PURGED')).toBe(true);
        // Open drafts are never purged; they expire first after 30 days without review.
        await h.analyze(adminA, 'insult', 0);
        const open = s.learningDrafts!.filter(d => d.status === 'DRAFT');
        const exp = await runNightlyLearning(h.repo, { orgId: adminA.orgId, scope: { departmentIds: null, synthetic: true }, localDate: 'x', now: new Date(future), force: true });
        expect(exp.expired).toBe(open.length);
    });

    it('Obsidian: ghi qua outbox được ủy quyền, từ chối read-only mount; không ghi đè file cũ', async () => {
        const dir = await fs.mkdtemp(path.join(process.env.QC_TEST_ROOT!, 'learning-outbox-'));
        await expect(new LearningObsidianOutbox(fixture, [fixture]).validate()).rejects.toMatchObject({ code: 'LEARNING_OUTBOX_INSIDE_READ_ONLY_VAULT' });
        await expect(new LearningObsidianOutbox(path.join(fixture, '01_QUY_TAC_UNG_XU'), [fixture]).validate()).rejects.toMatchObject({ code: 'LEARNING_OUTBOX_INSIDE_READ_ONLY_VAULT' });
        await expect(new LearningObsidianOutbox('/run/aiqc/obsidian/10_HOC', []).validate()).rejects.toMatchObject({ code: 'LEARNING_OUTBOX_INSIDE_READ_ONLY_VAULT' });
        await expect(new LearningObsidianOutbox('relative/path', []).validate()).rejects.toMatchObject({ code: 'LEARNING_OUTBOX_MUST_BE_ABSOLUTE' });
        const outbox = new LearningObsidianOutbox(dir, [fixture]);
        const before = (await fs.readdir(fixture, { recursive: true })).sort();
        const h = await harness(); await h.analyze(adminA, 'insult', 2);
        await nightly(h, { outbox });
        const d = (await h.repo.read(adminA.orgId)).learningDrafts![0]!;
        expect(d.obsidianExport).toMatchObject({ status: 'WRITTEN', revision: 1 });
        const written = await fs.readFile(path.join(dir, `LD-${d.id}.r1.md`), 'utf8');
        expect(written).toBe(d.markdown);
        await expect(outbox.write(d)).resolves.toBe(`10_HOC_TU_HOI_THOAI/LD-${d.id}.r1.md`);
        expect(await fs.readFile(path.join(dir, `LD-${d.id}.r1.md`), 'utf8')).toBe(written);
        expect((await fs.readdir(fixture, { recursive: true })).sort()).toEqual(before);
        expect(os.platform()).toBeTruthy();
    });

    it('cổng kích hoạt: chỉ chạy khi có lịch + phạm vi dữ liệu được duyệt; production NO-GO mặc định', async () => {
        const scope = JSON.stringify({ orgId: 'org-1', departmentIds: ['d1'], approvedBy: 'owner', approvedAt: '2026-11-12T00:00:00Z', reference: 'APPROVAL-001' });
        expect(nightlyLearningGate({}).blockers).toEqual(expect.arrayContaining(['NIGHTLY_LEARNING_DISABLED', 'SCHEDULE_NOT_APPROVED', 'DATA_SCOPE_NOT_APPROVED', 'PERSISTENT_STORAGE_REQUIRED', 'DEPLOYMENT_TIER_REQUIRED']));
        expect(nightlyLearningGate({ enabled: 'true', schedule: '21:00', scopeApproval: scope, realDataOrgId: 'org-1', storageMode: 'application', deploymentTier: 'local-test' }).blockers).toEqual(['SCHEDULE_NOT_APPROVED']);
        expect(nightlyLearningGate({ enabled: 'true', schedule: '22:00', scopeApproval: scope, realDataOrgId: 'org-2', storageMode: 'application', deploymentTier: 'local-test' }).blockers).toEqual(['DATA_SCOPE_TENANT_MISMATCH']);
        expect(nightlyLearningGate({ enabled: 'true', schedule: '22:00', scopeApproval: scope, realDataOrgId: 'org-1', storageMode: 'application', deploymentTier: 'production' }).blockers).toEqual(['PRODUCTION_NO_GO']);
        expect(nightlyLearningGate({ enabled: 'true', schedule: '22:30', scopeApproval: scope, realDataOrgId: 'org-1', storageMode: 'application', deploymentTier: 'local-test' }).allowed).toBe(true);
        const sched = { hour: 22, minute: 0, timeZone: 'Asia/Ho_Chi_Minh' };
        expect(nightlyDue(new Date('2026-11-12T14:59:00Z'), sched)).toBe(false); // 21:59 ICT
        expect(nightlyDue(new Date('2026-11-12T15:00:00Z'), sched)).toBe(true);  // 22:00 ICT
        const app = Fastify({ logger: false }); apps.push(app);
        const started = registerNightlyLearningScheduler(app, new MemoryWorkspaceRepository(), { storageMode: 'application', realDataOrgId: 'org-1', env: { AI_QC_NIGHTLY_LEARNING_ENABLED: 'true', AI_QC_NIGHTLY_LEARNING_SCHEDULE: '22:00', AI_QC_NIGHTLY_LEARNING_SCOPE_APPROVAL: scope, AI_QC_DEPLOYMENT_TIER: 'production' } });
        expect(started).toEqual({ started: false, blockers: ['PRODUCTION_NO_GO'] });
        // A real-data host labelled "local-test" but running NODE_ENV=production still needs the explicit GO.
        expect(nightlyLearningGate({ enabled: 'true', schedule: '22:00', scopeApproval: scope, realDataOrgId: 'org-1', storageMode: 'application', deploymentTier: 'local-test', nodeEnv: 'production' }).blockers).toEqual(['PRODUCTION_NO_GO']);
        expect(registerNightlyLearningScheduler(app, new MemoryWorkspaceRepository(), { storageMode: 'application', realDataOrgId: 'org-1', env: { NODE_ENV: 'production', AI_QC_NIGHTLY_LEARNING_ENABLED: 'true', AI_QC_NIGHTLY_LEARNING_SCHEDULE: '22:00', AI_QC_NIGHTLY_LEARNING_SCOPE_APPROVAL: scope, AI_QC_DEPLOYMENT_TIER: 'local-test' } })).toEqual({ started: false, blockers: ['PRODUCTION_NO_GO'] });
        expect(nightlyLearningGate({ enabled: 'true', schedule: '22:00', scopeApproval: scope, realDataOrgId: 'org-1', storageMode: 'application', deploymentTier: 'local-test', nodeEnv: 'production', productionGo: 'true' }).allowed).toBe(true);
        // Same local date runs once without force.
        const h = await harness(); await h.analyze(adminA, 'insult', 2);
        await runNightlyLearning(h.repo, { orgId: adminA.orgId, scope: { departmentIds: null, synthetic: true }, localDate: '2026-11-12' });
        expect((await runNightlyLearning(h.repo, { orgId: adminA.orgId, scope: { departmentIds: null, synthetic: true }, localDate: '2026-11-12' })).skipped).toBe('ALREADY_RAN_FOR_LOCAL_DATE');
    });

    it('realtime Socket.IO: Admin cùng tenant nhận tín hiệu sau phê duyệt; tenant khác và người thiếu quyền không nhận', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2);
        const app = Fastify({ logger: false }); apps.push(app);
        await app.listen({ port: 0, host: '127.0.0.1' });
        const io = new Server(app.server, { transports: ['websocket'] });
        const notifier = socketLearningNotifier(io, async socket => { const a = actors[String(socket.handshake.auth?.token)]; if (!a) throw new Error('UNAUTHORIZED'); return a; });
        const { call } = await api(h, { notifier });
        const url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/aiqc-learning`;
        const connect = (token: string) => new Promise<{ socket: ReturnType<typeof ioClient>; ok: boolean; got: unknown[] }>(resolve => {
            const socket = ioClient(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true }), got: unknown[] = [];
            socket.on('aiqc:learning-drafts-changed', e => got.push(e));
            socket.on('connect', () => resolve({ socket, ok: true, got }));
            socket.on('connect_error', () => resolve({ socket, ok: false, got }));
        });
        const a1 = await connect(adminA.id), a2 = await connect(adminA2.id), b = await connect(adminB.id), viewer = await connect(viewerA.id);
        try {
            expect([a1.ok, a2.ok, b.ok, viewer.ok]).toEqual([true, true, true, false]);
            await runNightlyLearning(h.repo, { orgId: adminA.orgId, scope: { departmentIds: null, synthetic: true }, localDate: 'rt', force: true, notifier });
            const d = (await call(adminA, 'GET', '')).body.items[0], det = (await call(adminA, 'GET', '/' + d.id)).body;
            await call(adminA, 'POST', `/${d.id}/verify-scope`, { expectedRevision: d.revision });
            await call(adminA, 'POST', `/${d.id}/approve`, { expectedRevision: d.revision, contentHash: det.contentHash, confirm: true });
            await new Promise(r => setTimeout(r, 150));
            const reasons = (x: unknown[]) => x.map(e => (e as { reason: string }).reason);
            expect(reasons(a1.got)).toEqual(['NIGHTLY_RUN', 'SCOPE_VERIFIED', 'APPROVED']);
            expect(reasons(a2.got)).toEqual(['NIGHTLY_RUN', 'SCOPE_VERIFIED', 'APPROVED']);
            expect(b.got).toEqual([]);
            expect(JSON.stringify(a1.got)).not.toContain('markdown');
            // The second Admin re-fetches and sees the fresh state (no stale pending badge).
            expect((await call(adminA2, 'GET', '/summary')).body.pending).toBe(0);
        } finally { for (const c of [a1, a2, b, viewer]) c.socket.close(); io.close(); }
    });
    it('PostgreSQL-style conflicts: transient WORKSPACE_CONFLICT is retried; persistent conflict surfaces as 409 after bounded attempts', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        let failures = 2, calls = 0;
        const flaky: WorkspaceRepository = { read: o => h.repo.read(o), mutate: (o, fn) => { calls++; if (failures-- > 0) return Promise.reject(new QcError('WORKSPACE_CONFLICT', 409)); return h.repo.mutate(o, fn); } };
        const svc = new LearningDraftService(flaky, async () => undefined);
        const d = (await svc.list(adminA)).items[0]!;
        await expect(svc.reject(adminA, d.id, { expectedRevision: d.revision, reason: 'Không dùng' })).resolves.toMatchObject({ status: 'REJECTED' });
        expect(calls).toBe(3);
        const stuck: WorkspaceRepository = { read: o => h.repo.read(o), mutate: () => Promise.reject(new QcError('WORKSPACE_CONFLICT', 409)) };
        await expect(mutateWithRetry(stuck, adminA.orgId, () => 1, { attempts: 3 })).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT', statusCode: 409 });
        // Non-conflict errors are never retried.
        let other = 0;
        const broken: WorkspaceRepository = { read: o => h.repo.read(o), mutate: () => { other++; return Promise.reject(new QcError('LEARNING_DRAFT_ALREADY_DECIDED', 409)); } };
        await expect(mutateWithRetry(broken, adminA.orgId, () => 1)).rejects.toMatchObject({ code: 'LEARNING_DRAFT_ALREADY_DECIDED' });
        expect(other).toBe(1);
    });

    it('retention: purging a REJECTED draft (7-day policy) keeps the 30-day suppression via a content-free tombstone', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const svc = new LearningDraftService(h.repo, async () => undefined);
        const d = (await svc.list(adminA)).items.find(i => i.findingType === 'INSULT')!;
        await svc.reject(adminA, d.id, { expectedRevision: d.revision, reason: 'Không phù hợp' });
        await h.repo.mutate(adminA.orgId, s => { s.settings.retentionDays = 7; s.settings.retentionApprovedBy = adminA.id; s.learningDrafts!.find(x => x.id === d.id)!.updatedAt = new Date(Date.now() - 10 * 86400000).toISOString(); });
        const p = await purgeLearningDrafts(h.repo, adminA, 'Định kỳ 7 ngày');
        expect(p).toMatchObject({ deleted: 1, suppressionsKept: 1 });
        const s = await h.repo.read(adminA.orgId);
        expect(s.learningDrafts!.some(x => x.id === d.id)).toBe(false);
        expect(s.learningSuppressions).toHaveLength(1);
        expect(JSON.stringify(s.learningSuppressions)).not.toMatch(/đồ ngu|INSULT|Tình huống/);
        await h.analyze(adminA, 'insult', 2);
        const again = await nightly(h);
        expect(again.created).toBe(0);
        expect((await h.repo.read(adminA.orgId)).learningDrafts!.filter(x => x.findingType === 'INSULT' && x.lessonKind === 'RECURRING_FINDING')).toHaveLength(0);
        // After the 30-day window the tombstone no longer suppresses and is pruned by the next purge.
        await h.repo.mutate(adminA.orgId, st => { st.learningSuppressions![0]!.until = new Date(Date.now() - 1000).toISOString(); });
        await h.analyze(adminA, 'insult', 2);
        expect((await nightly(h)).created).toBeGreaterThanOrEqual(1);
        expect((await purgeLearningDrafts(h.repo, adminA, 'Định kỳ')).prunedSuppressions).toBe(1);
    });

    it('Obsidian outbox: a human revision is staged immediately; purge lists outbox copies for operator cleanup (never auto-deleted)', async () => {
        const dir = await fs.mkdtemp(path.join(process.env.QC_TEST_ROOT!, 'learning-outbox-'));
        const outbox = new LearningObsidianOutbox(dir, [fixture]);
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h, { outbox });
        const { call } = await api(h, { outbox });
        const d = (await call(adminA, 'GET', '')).body.items[0];
        await call(adminA, 'POST', `/${d.id}/request-changes`, { expectedRevision: d.revision, note: 'Làm rõ' });
        const rv = await call(adminA, 'POST', `/${d.id}/revise`, { expectedRevision: d.revision, title: 'Phân biệt trích dẫn và xúc phạm', rationale: 'Bổ sung hướng dẫn xử lý.' });
        expect(rv.body.obsidianExport).toMatchObject({ status: 'WRITTEN', revision: 2 });
        expect(await fs.readFile(path.join(dir, `LD-${d.id}.r2.md`), 'utf8')).toBe(rv.body.markdown);
        await call(adminA, 'POST', `/${d.id}/reject`, { expectedRevision: 2, reason: 'Không dùng' });
        await h.repo.mutate(adminA.orgId, s => { s.settings.retentionDays = 7; s.settings.retentionApprovedBy = adminA.id; s.learningDrafts!.find(x => x.id === d.id)!.updatedAt = new Date(Date.now() - 8 * 86400000).toISOString(); });
        const p = await call(adminA, 'POST', '/purge-expired', { reason: 'Định kỳ' });
        expect(p.body.outboxFiles).toEqual([`10_HOC_TU_HOI_THOAI/LD-${d.id}.r*.md`]);
        expect((await fs.readdir(dir)).filter(f => f.startsWith('LD-' + d.id))).toHaveLength(2);
    });

    it('monitoring /health: Admin-only, counts and codes only, shows gate blockers, outbox failures and capacity alerts', async () => {
        const h = await harness(); await h.analyze(adminA, 'insult', 2); await nightly(h);
        const { call } = await api(h);
        expect((await call(viewerA, 'GET', '/health')).status).toBe(403);
        expect((await call(approverNoViewAll, 'GET', '/health')).status).toBe(403);
        const ok = await call(adminA, 'GET', '/health');
        expect(ok.status).toBe(200);
        expect(ok.body.scheduler.allowed).toBe(false);
        expect(ok.body.scheduler.blockers).toEqual(expect.arrayContaining(['NIGHTLY_LEARNING_DISABLED', 'PERSISTENT_STORAGE_REQUIRED']));
        expect(ok.body.drafts).toMatchObject({ pending: 1, limit: 300, openLimit: 100 });
        expect(ok.body.lastJob).toMatchObject({ scope: 'SYNTHETIC', created: 1 });
        expect(JSON.stringify(ok.body)).not.toMatch(/markdown|rationale|approvedBy|đồ ngu/);
        await h.repo.mutate(adminA.orgId, s => { s.learningDrafts![0]!.obsidianExport = { status: 'FAILED', path: null, revision: 1, error: 'LEARNING_OUTBOX_NOT_FOUND_OR_SYMLINK' }; });
        const failed = (await api(h, { outbox: new LearningObsidianOutbox(fixture, []) })).call;
        const r = (await failed(adminA, 'GET', '/health')).body;
        expect(r.outbox).toMatchObject({ configured: true, failed: 1, lastErrorCodes: ['LEARNING_OUTBOX_NOT_FOUND_OR_SYMLINK'] });
        expect(r.alerts).toContain('OBSIDIAN_OUTBOX_FAILURES');
    });

    it('version(): memory repository exposes the committed version for the realtime bridge', async () => {
        const repo = new MemoryWorkspaceRepository();
        expect(await repo.version('x')).toBe(0);
        await repo.mutate('x', () => undefined); await repo.mutate('x', () => undefined);
        expect(await repo.version('x')).toBe((await repo.read('x')).version);
    });
});
