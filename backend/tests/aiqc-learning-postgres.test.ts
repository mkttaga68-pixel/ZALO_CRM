/**
 * AIQC Nightly Learning — PostgreSQL concurrency (real PostgreSQL 18, Serializable + optimistic version).
 * Runs ONLY through scripts/run-aiqc-learning-postgres-tests.cjs, which creates a fresh disposable loopback cluster.
 * Synthetic data only; no OpenAI, no CRM conversations, never the application database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { QcError, type Actor, type Rule } from '../src/modules/ai-quality-control/contracts.js';
import { PrismaWorkspaceRepository } from '../src/modules/ai-quality-control/repository.js';
import { KnowledgeApprovalService, ObsidianKnowledgeService } from '../src/modules/ai-quality-control/knowledge.js';
import { AIProviderService, providerEnvironment } from '../src/modules/ai-quality-control/providers.js';
import { ConversationAnalyzerService } from '../src/modules/ai-quality-control/analysis.js';
import { AITrainingCenterService } from '../src/modules/ai-quality-control/training.js';
import { LearningDraftService, mutateWithRetry, runNightlyLearning } from '../src/modules/ai-quality-control/learning-drafts.js';

const url = process.env.AIQC_LEARNING_PG_URL, dbName = process.env.AIQC_LEARNING_PG_DB;
// Skipped in the generic backend run (no sandbox URL). When a URL IS provided it must be a loopback ai_qc_sandbox_* database
// on a non-application port, otherwise the suite refuses to run.
const enabled = !!url;
if (enabled && (!dbName || !/^ai_qc_sandbox_[a-z0-9_]+$/.test(dbName) || !['127.0.0.1', 'localhost'].includes(new URL(url!).hostname) || ['5432', '5433'].includes(new URL(url!).port)))
    throw new Error('Use node scripts/run-aiqc-learning-postgres-tests.cjs (fresh loopback sandbox cluster only).');

const fixture = path.resolve('fixtures/ai-quality-control/vault');
const ALL: Actor['permissions'] = ['access', 'create', 'edit', 'approve', 'delete', 'view_all'];
const org = (n: string) => 'pg-synthetic-' + n + '-' + Date.now().toString(36);
const admin = (orgId: string, id = 'pg-admin-1'): Actor => ({ id, orgId, departmentIds: [], permissions: ALL });
const rule = (type: Rule['type'], term: string): Rule => ({ id: 'synthetic-' + type, type, matchTerms: term ? [term] : [], conflictGroup: null, slaSeconds: type === 'UNRESOLVED_REQUEST' ? 300 : null, careIntervalDays: null });
const docType = (p: string): Rule['type'] => p.includes('courtesy') ? 'COURTESY' : p.includes('request') ? 'UNRESOLVED_REQUEST' : p.includes('product') ? 'KNOWLEDGE_MISMATCH' : 'INSULT';
const terms: Record<Rule['type'], string> = { INSULT: 'đồ ngu', COURTESY: 'tự đi mà tìm', UNRESOLVED_REQUEST: '', KNOWLEDGE_MISMATCH: 'SYNTHETIC-A miễn phí' };

let db: PrismaClient, repo: PrismaWorkspaceRepository;
beforeAll(async () => {
    if (!enabled) return;
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url!, max: 20 }), log: [] });
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    if (name !== dbName) throw new Error('Sandbox database identity mismatch');
    repo = new PrismaWorkspaceRepository(db);
});
afterAll(async () => { await db?.$disconnect(); });

async function seeded(orgId: string, scenarios: Array<[string, number]>) {
    const a = admin(orgId), environment = providerEnvironment({ AI_QC_ENABLED: 'true', AI_QC_REAL_API_ENABLED: 'false', AI_QC_REAL_DATA_ENABLED: 'false' });
    await new ObsidianKnowledgeService(() => [fixture], fixture).sync(a, repo, fixture);
    const approval = new KnowledgeApprovalService(repo);
    for (const d of (await repo.read(orgId)).documents) { const t = docType(d.sourcePath); await approval.publish(a, d.id, { hash: d.contentHash, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: null, departmentIds: [], rule: rule(t, terms[t]) }); }
    const training = new AITrainingCenterService(repo, new ConversationAnalyzerService(repo, new AIProviderService(environment), environment));
    for (const [scenario, n] of scenarios) for (let i = 0; i < n; i++) { const d = await training.create(a, { name: `pg-${scenario}-${i}`, scenario } as never); await training.analyze(a, d.id, 'mock'); }
    return a;
}
const code = (e: unknown) => e instanceof QcError ? e.code : 'UNMAPPED:' + ((e as Error)?.constructor?.name ?? typeof e) + ':' + String((e as { code?: string })?.code ?? '');

describe.skipIf(!enabled)('AIQC Nightly Learning — PostgreSQL concurrency', () => {
    it('raw Serializable workspace: concurrent writers never lose an update; every failure is a mapped WORKSPACE_CONFLICT', async () => {
        const o = org('raw');
        await repo.mutate(o, s => { s.audits = []; });
        const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => repo.mutate(o, s => { s.audits.push({ id: 'w' + i } as never); return i; })));
        const ok = outcomes.filter(r => r.status === 'fulfilled').length;
        const errors = outcomes.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => code(r.reason));
        expect(errors.every(e => e === 'WORKSPACE_CONFLICT')).toBe(true);
        const s = await repo.read(o);
        expect(s.audits.length).toBe(ok); // no lost update: exactly the committed writers are visible
        console.log(JSON.stringify({ rawConcurrentWriters: 12, committed: ok, conflicts: errors.length }));
    });

    it('first-time workspace creation race (concurrent upsert on a missing row) is mapped, never an unhandled driver error', async () => {
        const o = org('first');
        const outcomes = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => repo.mutate(o, s => { s.audits.push({ id: 'f' + i } as never); })));
        const errors = outcomes.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => code(r.reason));
        expect(errors.every(e => e === 'WORKSPACE_CONFLICT')).toBe(true);
        expect((await repo.read(o)).audits.length).toBe(outcomes.length - errors.length);
    });

    it('mutateWithRetry: 12 concurrent writers all commit, final state has all 12 updates', async () => {
        const o = org('retry');
        await repo.mutate(o, s => { s.audits = []; });
        const results = await Promise.all(Array.from({ length: 12 }, (_, i) => mutateWithRetry(repo, o, s => { s.audits.push({ id: 'r' + i } as never); return i; }, { attempts: 12 })));
        expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: 12 }, (_, i) => i));
        const s = await repo.read(o);
        expect(new Set(s.audits.map(a => a.id)).size).toBe(12);
    });

    it('version(): lightweight read matches the committed payload version', async () => {
        const o = org('version');
        await repo.mutate(o, () => undefined); await repo.mutate(o, () => undefined);
        expect(await repo.version(o)).toBe((await repo.read(o)).version);
        expect(await repo.version(org('missing'))).toBe(0);
    });

    it('two Admins decide the same draft concurrently: exactly one wins, the other gets a semantic 409 (not a storage conflict)', async () => {
        const o = org('same'), a1 = await seeded(o, [['insult', 2]]), a2 = admin(o, 'pg-admin-2');
        await runNightlyLearning(repo, { orgId: o, scope: { departmentIds: null, synthetic: true }, localDate: 'pg-1', force: true });
        const svc = new LearningDraftService(repo, async () => undefined);
        const d = (await svc.list(a1)).items[0]!, det = await svc.get(a1, d.id);
        await svc.verifyScope(a1, d.id, d.revision);
        const outcomes = await Promise.allSettled([
            svc.approve(a1, d.id, { expectedRevision: d.revision, contentHash: det.contentHash, confirm: true }),
            svc.reject(a2, d.id, { expectedRevision: d.revision, reason: 'Không cần thiết' }),
        ]);
        const ok = outcomes.filter(r => r.status === 'fulfilled');
        const errs = outcomes.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => code(r.reason));
        expect(ok).toHaveLength(1);
        expect(errs).toEqual(['LEARNING_DRAFT_ALREADY_DECIDED']);
        const s = await repo.read(o);
        const draft = s.learningDrafts!.find(x => x.id === d.id)!;
        expect(s.documents.filter(x => x.learningDraftId === d.id).length).toBe(draft.status === 'APPROVED' ? 1 : 0);
        expect(draft.reviewHistory.filter(h => ['APPROVED', 'REJECTED'].includes(h.action))).toHaveLength(1);
    });

    it('unrelated concurrent decisions on different drafts both succeed (no spurious WORKSPACE_CONFLICT for Admins)', async () => {
        const o = org('diff'), a1 = await seeded(o, [['insult', 2], ['knowledge', 2]]), a2 = admin(o, 'pg-admin-2');
        await runNightlyLearning(repo, { orgId: o, scope: { departmentIds: null, synthetic: true }, localDate: 'pg-2', force: true });
        const svc = new LearningDraftService(repo, async () => undefined);
        const items = (await svc.list(a1)).items;
        expect(items.length).toBeGreaterThanOrEqual(2);
        const [x, y] = items as [typeof items[0], typeof items[0]];
        for (let round = 0; round < 3; round++) {
            const results = await Promise.allSettled([
                svc.verifyScope(a1, x.id, x.revision), svc.verifyScope(a2, y.id, y.revision),
            ]);
            expect(results.map(r => r.status === 'rejected' ? code(r.reason) : 'OK')).toEqual(['OK', 'OK']);
            const s = await repo.read(o);
            expect(s.learningDrafts!.filter(d => d.tenantScope).length).toBe(2);
            await mutateWithRetry(repo, o, st => { for (const d of st.learningDrafts!) d.tenantScope = null; });
        }
        const [r1, r2] = await Promise.allSettled([
            svc.reject(a1, x.id, { expectedRevision: x.revision, reason: 'Không dùng' }),
            svc.requestChanges(a2, y.id, { expectedRevision: y.revision, note: 'Làm rõ thêm' }),
        ]);
        expect([r1.status, r2.status]).toEqual(['fulfilled', 'fulfilled']);
    });

    it('multi-instance nightly: two backends run the same local date concurrently → exactly one job, the other is skipped', async () => {
        const o = org('multi'); await seeded(o, [['insult', 2]]);
        const run = () => runNightlyLearning(repo, { orgId: o, scope: { departmentIds: null, synthetic: true }, localDate: '2026-11-12' });
        const outcomes = await Promise.allSettled([run(), run(), run()]);
        expect(outcomes.map(r => r.status === 'rejected' ? code(r.reason) : 'OK')).toEqual(['OK', 'OK', 'OK']);
        const values = outcomes.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof run>>>).value);
        expect(values.filter(v => v.skipped === null)).toHaveLength(1);
        expect(values.filter(v => v.skipped === 'ALREADY_RAN_FOR_LOCAL_DATE')).toHaveLength(2);
        const s = await repo.read(o);
        expect(s.learningJobs!.filter(j => j.localDate === '2026-11-12')).toHaveLength(1);
        expect(s.learningDrafts!.filter(d => d.findingType === 'INSULT' && d.lessonKind === 'RECURRING_FINDING')).toHaveLength(1);
    });

    it('nightly merge concurrent with an Admin approval on another draft: both commit, no evidence lost', async () => {
        const o = org('merge'), a1 = await seeded(o, [['insult', 2], ['knowledge', 2]]);
        await runNightlyLearning(repo, { orgId: o, scope: { departmentIds: null, synthetic: true }, localDate: 'pg-m1', force: true });
        const svc = new LearningDraftService(repo, async () => undefined);
        const k = (await svc.list(a1)).items.find(i => i.findingType === 'KNOWLEDGE_MISMATCH')!;
        await svc.verifyScope(a1, k.id, k.revision);
        const det = await svc.get(a1, k.id);
        // New insult evidence arrives, then nightly merge races the approval.
        const environment = providerEnvironment({ AI_QC_ENABLED: 'true', AI_QC_REAL_API_ENABLED: 'false', AI_QC_REAL_DATA_ENABLED: 'false' });
        const training = new AITrainingCenterService(repo, new ConversationAnalyzerService(repo, new AIProviderService(environment), environment));
        const ds = await training.create(a1, { name: 'pg-insult-late', scenario: 'insult' } as never); await training.analyze(a1, ds.id, 'mock');
        const [n, ap] = await Promise.allSettled([
            runNightlyLearning(repo, { orgId: o, scope: { departmentIds: null, synthetic: true }, localDate: 'pg-m2', force: true }),
            svc.approve(a1, k.id, { expectedRevision: k.revision, contentHash: det.contentHash, confirm: true }),
        ]);
        expect([n.status === 'rejected' ? code(n.reason) : 'OK', ap.status === 'rejected' ? code(ap.reason) : 'OK']).toEqual(['OK', 'OK']);
        const s = await repo.read(o);
        expect(s.learningDrafts!.find(d => d.id === k.id)!.status).toBe('APPROVED');
        expect(s.learningDrafts!.find(d => d.findingType === 'INSULT')!.caseCount).toBe(3);
    });
});
