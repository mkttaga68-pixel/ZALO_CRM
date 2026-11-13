/**
 * Kho quy tắc: đồng bộ Obsidian báo đủ kết quả và tự dọn bản nháp đã bị thay thế.
 * Vault là thư mục tạm; repository trong bộ nhớ — không chạm DB/vault thật.
 */
import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Actor } from '../src/modules/ai-quality-control/contracts.js';
import { MemoryWorkspaceRepository } from '../src/modules/ai-quality-control/repository.js';
import { KnowledgeApprovalService, ObsidianKnowledgeService, pruneSupersededDrafts } from '../src/modules/ai-quality-control/knowledge.js';

const admin: Actor = { id: 'admin-1', orgId: 'org-sync', departmentIds: [], permissions: ['access', 'create', 'edit', 'approve', 'delete', 'view_all'] };
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => fs.rm(d, { recursive: true, force: true }))); });

async function setup() {
    const vault = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aiqc-sync-vault-')));
    const other = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aiqc-sync-synthetic-')));
    dirs.push(vault, other);
    await fs.mkdir(path.join(vault, '01_QUY_TAC_UNG_XU'));
    const write = (rel: string, text: string) => fs.writeFile(path.join(vault, rel), text, 'utf8');
    await write('01_QUY_TAC_UNG_XU/UX-001.md', '# Không xúc phạm khách\nNội dung r1\n');
    await write('01_QUY_TAC_UNG_XU/UX-002.md', '# Lịch sự\nNội dung\n');
    const repo = new MemoryWorkspaceRepository();
    const service = new ObsidianKnowledgeService(() => [vault], other);
    return { vault, write, repo, sync: () => service.sync(admin, repo, vault) };
}
const rule = { id: 'UX-001', type: 'INSULT' as const, matchTerms: ['xúc phạm'], conflictGroup: null, slaSeconds: null, careIntervalDays: null };

describe('Đồng bộ Kho quy tắc', () => {
    it('reports new, updated and unchanged documents plus workspace capacity', async () => {
        const { write, sync } = await setup();
        expect(await sync()).toMatchObject({ added: 2, updated: 0, unchanged: 0, scanned: 2, pruned: 0, missing: [], issues: [], coverage: 'SCANNED_WITHIN_LIMITS', capacity: { documents: 2, limit: 1000 } });
        expect(await sync()).toMatchObject({ added: 0, updated: 0, unchanged: 2, pruned: 0 });
        await write('01_QUY_TAC_UNG_XU/UX-001.md', '# Không xúc phạm khách\nNội dung r2\n');
        expect(await sync()).toMatchObject({ added: 0, updated: 1, unchanged: 1 });
    });

    it('drops superseded never-approved drafts so edits do not pile up toward the 1000-version limit', async () => {
        const { write, repo, sync } = await setup();
        await sync();
        for (let r = 2; r <= 5; r++) { await write('01_QUY_TAC_UNG_XU/UX-001.md', `# Không xúc phạm khách\nNội dung r${r}\n`); await sync(); }
        const docs = (await repo.read(admin.orgId)).documents.filter(d => d.sourcePath.endsWith('UX-001.md'));
        expect(docs.map(d => [d.revision, d.status])).toEqual([[5, 'DRAFT']]);
        const audit = (await repo.read(admin.orgId)).audits.filter(a => a.action === 'KNOWLEDGE_DRAFT_SYNC').at(-1)!;
        expect(audit.details).toMatchObject({ pruned: 1, prunedRevisions: [expect.objectContaining({ revision: 4 })] });
        expect(JSON.stringify(audit.details)).not.toContain('Nội dung');
    });

    it('never removes approved or revoked versions, only the drafts between them', async () => {
        const { write, repo, sync } = await setup();
        await sync();
        const r1 = (await repo.read(admin.orgId)).documents.find(d => d.sourcePath.endsWith('UX-001.md'))!;
        await new KnowledgeApprovalService(repo).publish(admin, r1.id, { hash: r1.contentHash, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: null, departmentIds: [], rule });
        await write('01_QUY_TAC_UNG_XU/UX-001.md', '# Không xúc phạm khách\nNội dung r2\n'); await sync();
        await write('01_QUY_TAC_UNG_XU/UX-001.md', '# Không xúc phạm khách\nNội dung r3\n');
        expect(await sync()).toMatchObject({ updated: 1, pruned: 1 });
        const docs = (await repo.read(admin.orgId)).documents.filter(d => d.sourcePath.endsWith('UX-001.md')).sort((a, b) => a.revision - b.revision);
        expect(docs.map(d => [d.revision, d.status])).toEqual([[1, 'APPROVED'], [3, 'DRAFT']]);
    });

    it('lists library documents whose file disappeared from Obsidian, without counting unreadable files as missing', async () => {
        const { vault, write, sync } = await setup();
        await write('01_QUY_TAC_UNG_XU/UX-003.md', '# Tạm\n');
        await sync();
        await fs.rm(path.join(vault, '01_QUY_TAC_UNG_XU/UX-002.md'));
        await write('01_QUY_TAC_UNG_XU/UX-003.md', 'x'.repeat(256 * 1024 + 1));
        const r = await sync();
        expect(r.missing).toEqual([{ sourcePath: '01_QUY_TAC_UNG_XU/UX-002.md', status: 'DRAFT', active: false }]);
        expect(r.issues).toEqual([{ path: '01_QUY_TAC_UNG_XU/UX-003.md', code: 'FILE_SIZE_OR_LINK_REJECTED' }]);
        expect(r.coverage).toBe('PARTIAL');
    });

    it('a draft whose Obsidian file was deleted is marked and cannot be published; the mark clears when the file returns', async () => {
        const { vault, write, repo, sync } = await setup();
        await sync();
        await fs.rm(path.join(vault, '01_QUY_TAC_UNG_XU/UX-001.md'));
        await sync();
        const draft = (await repo.read(admin.orgId)).documents.find(d => d.sourcePath.endsWith('UX-001.md'))!;
        expect(draft.sourceMissingAt).toEqual(expect.any(String));
        await expect(new KnowledgeApprovalService(repo).publish(admin, draft.id, { hash: draft.contentHash, effectiveFrom: new Date().toISOString(), effectiveTo: null, departmentIds: [], rule }))
            .rejects.toMatchObject({ code: 'SOURCE_FILE_MISSING' });
        await write('01_QUY_TAC_UNG_XU/UX-001.md', '# Không xúc phạm khách\nNội dung r1\n');
        expect(await sync()).toMatchObject({ added: 0, updated: 0, missing: [] });
        expect((await repo.read(admin.orgId)).documents.find(d => d.id === draft.id)!.sourceMissingAt).toBeNull();
        const audit = (await repo.read(admin.orgId)).audits.filter(a => a.action === 'KNOWLEDGE_DRAFT_SYNC').at(-1)!;
        expect(audit.details).toMatchObject({ restored: [draft.documentId] });
    });

    it('an approved rule whose file was deleted is flagged as still in force (not silently revoked)', async () => {
        const { vault, repo, sync } = await setup();
        await sync();
        const r1 = (await repo.read(admin.orgId)).documents.find(d => d.sourcePath.endsWith('UX-001.md'))!;
        await new KnowledgeApprovalService(repo).publish(admin, r1.id, { hash: r1.contentHash, effectiveFrom: new Date(Date.now() - 86400000).toISOString(), effectiveTo: null, departmentIds: [], rule });
        await fs.rm(path.join(vault, '01_QUY_TAC_UNG_XU/UX-001.md'));
        const r = await sync();
        expect(r.missing).toEqual([{ sourcePath: '01_QUY_TAC_UNG_XU/UX-001.md', status: 'APPROVED', active: true }]);
        const doc = (await repo.read(admin.orgId)).documents.find(d => d.id === r1.id)!;
        expect(doc).toMatchObject({ status: 'APPROVED', sourceMissingAt: expect.any(String) });
        expect((await repo.read(admin.orgId)).audits.filter(a => a.action === 'KNOWLEDGE_DRAFT_SYNC').at(-1)!.details).toMatchObject({ missingActive: 1 });
    });

    it('verifySource re-reads the vault at publication time, also for an approver without view_all', async () => {
        const { vault, write, repo, sync } = await setup();
        await sync();
        const service = new ObsidianKnowledgeService(() => [vault], path.join(vault, '..'));
        const deptApprover: Actor = { id: 'lead-1', orgId: admin.orgId, departmentIds: ['d1'], permissions: ['access', 'approve'] };
        const doc = (await repo.read(admin.orgId)).documents.find(d => d.sourcePath.endsWith('UX-001.md'))!;
        await expect(service.verifySource(deptApprover, vault, doc)).resolves.toBeUndefined();
        await write('01_QUY_TAC_UNG_XU/UX-001.md', '# Không xúc phạm khách\nĐã sửa sau đồng bộ\n');
        await expect(service.verifySource(deptApprover, vault, doc)).rejects.toMatchObject({ code: 'SOURCE_CHANGED_SINCE_SYNC' });
        await fs.rm(path.join(vault, '01_QUY_TAC_UNG_XU/UX-001.md'));
        await expect(service.verifySource(deptApprover, vault, doc)).rejects.toMatchObject({ code: 'SOURCE_FILE_MISSING' });
        // Choosing/scanning a vault path from the UI still requires edit + view_all.
        await expect(service.scan(deptApprover, vault)).rejects.toMatchObject({ code: 'QC_FORBIDDEN' });
    });

    it('pruneSupersededDrafts leaves Verified Learning Cases and the newest draft alone', () => {
        const base = { orgId: 'o', sourcePath: 'p.md', markdown: '', contentHash: 'h', category: 'x', synthetic: false, stagedBy: 'a', approvedBy: null, approvedAt: null, effectiveFrom: null, effectiveTo: null, departmentIds: [], rule: null };
        const state = { documents: [
            { ...base, id: '1', documentId: 'A', revision: 1, status: 'DRAFT' },
            { ...base, id: '2', documentId: 'A', revision: 2, status: 'DRAFT' },
            { ...base, id: '3', documentId: 'B', revision: 1, status: 'APPROVED', knowledgeClass: 'VERIFIED_LEARNING_CASE' },
            { ...base, id: '4', documentId: 'B', revision: 2, status: 'DRAFT' },
        ] } as never;
        expect(pruneSupersededDrafts(state).map(p => p.revision)).toEqual([1]);
        expect((state as { documents: Array<{ id: string }> }).documents.map(d => d.id)).toEqual(['2', '3', '4']);
    });
});
