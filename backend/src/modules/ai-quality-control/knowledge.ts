import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { ANALYSIS_TYPES, canReadDocument, demand, iso, QcError, type Actor, type Audit, type Citation, type KnowledgeChunk, type KnowledgeVersion, type Rule, type Workspace, type WorkspaceRepository } from './contracts.js';
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function audit(state: Workspace, actor: Actor, action: string, resourceId: string, details: Record<string, unknown> = {}) {
    state.audits.push({ id: randomUUID(), orgId: actor.orgId, actorId: actor.id, action, resourceId, at: new Date().toISOString(), details } satisfies Audit);
}
export const BRAIN_GROUPS = ['01_QUY_TAC_UNG_XU', '02_QUY_TRINH_CSKH', '03_SLA_PHAN_HOI', '04_CA_TRUC_NGAY_NGHI', '05_KIEN_THUC_SAN_PHAM', '06_TINH_HUONG_MAU', '07_QUY_TAC_DANH_GIA_AI', '08_KIEM_DUYET', '09_BO_TEST_AI'];
export interface ScannedDocument {
    sourcePath: string;
    markdown: string;
    contentHash: string;
    category: string;
    synthetic: boolean;
}
const keyPath = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (root: string, child: string) => { const relative = path.relative(root, child); return relative !== '' && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); };
export class ObsidianKnowledgeService {
    constructor(private roots: (orgId: string) => string[], private syntheticRoot: string) { }
    async validateVaultPath(actor: Actor, root: string) {
        demand(actor, 'edit');
        demand(actor, 'view_all');
        if (typeof root !== 'string' || !path.isAbsolute(root))
            throw new QcError('VAULT_PATH_MUST_BE_ABSOLUTE');
        const resolved = path.resolve(root);
        if (!this.roots(actor.orgId).some(p => keyPath(path.resolve(p)) === keyPath(resolved)))
            throw new QcError('VAULT_NOT_ALLOWED_FOR_TENANT', 403);
        const stat = await fs.lstat(resolved).catch(() => null);
        if (!stat?.isDirectory() || stat.isSymbolicLink())
            throw new QcError('VAULT_NOT_FOUND_OR_SYMLINK');
        const real = await fs.realpath(resolved);
        if (keyPath(real) !== keyPath(resolved))
            throw new QcError('VAULT_SYMLINK_BOUNDARY_REJECTED');
        const allowed = await Promise.all(this.roots(actor.orgId).map(p => fs.realpath(p).catch(() => '')));
        if (!allowed.some(p => p && keyPath(p) === keyPath(real)))
            throw new QcError('VAULT_NOT_ALLOWED_FOR_TENANT', 403);
        return real;
    }
    async scan(actor: Actor, root: string) {
        const real = await this.validateVaultPath(actor, root);
        const docs: ScannedDocument[] = [];
        const issues: Array<{
            path: string;
            code: string;
        }> = [];
        let visited = 0;
        const synthetic = keyPath(real) === keyPath(await fs.realpath(this.syntheticRoot).catch(() => ''));
        const walk = async (dir: string, depth: number): Promise<void> => {
            if (depth > 8)
                throw new QcError('VAULT_DEPTH_LIMIT');
            for (const entry of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
                if (++visited > 2000)
                    throw new QcError('VAULT_ENTRY_LIMIT');
                if (entry.name.startsWith('.'))
                    continue;
                // The real vault may ship a sample test suite; it is not company policy.
                if (!synthetic && depth === 0 && entry.name === '09_BO_TEST_AI')
                    continue;
                const file = path.join(dir, entry.name), relative = path.relative(real, file).split(path.sep).join('/');
                if (entry.isSymbolicLink()) {
                    issues.push({ path: relative, code: 'SYMLINK_REJECTED' });
                    continue;
                }
                if (entry.isDirectory()) {
                    await walk(file, depth + 1);
                    continue;
                }
                if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md')
                    continue;
                if (docs.length >= 500)
                    throw new QcError('VAULT_DOCUMENT_LIMIT');
                let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
                try {
                    if (keyPath(await fs.realpath(real)) !== keyPath(real) || !within(real, await fs.realpath(file)))
                        throw new QcError('PATH_ESCAPED_VAULT');
                    const before = await fs.lstat(file);
                    if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1 || before.size > 256 * 1024)
                        throw new QcError('FILE_SIZE_OR_LINK_REJECTED');
                    handle = await fs.open(file, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
                    const opened = await handle.stat();
                    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.size !== before.size)
                        throw new QcError('FILE_CHANGED_DURING_SCAN');
                    const buffer = Buffer.alloc(before.size + 1);
                    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
                    const after = await handle.stat();
                    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || !within(real, await fs.realpath(file)))
                        throw new QcError('FILE_CHANGED_DURING_SCAN');
                    const bytes = buffer.subarray(0, bytesRead), markdown = bytes.toString('utf8');
                    if (!Buffer.from(markdown, 'utf8').equals(bytes))
                        throw new QcError('INVALID_UTF8');
                    docs.push({ sourcePath: relative, markdown, contentHash: digest(bytes), category: BRAIN_GROUPS.find(g => relative === g || relative.startsWith(g + '/')) ?? 'UNCLASSIFIED', synthetic });
                }
                catch (error) {
                    issues.push({ path: relative, code: error instanceof QcError ? error.code : 'FILE_UNREADABLE' });
                }
                finally {
                    await handle?.close();
                }
            }
        };
        await walk(real, 0);
        return { documents: docs, issues, coverage: issues.length ? 'PARTIAL' : 'SCANNED_WITHIN_LIMITS' };
    }
    async sync(actor: Actor, repo: WorkspaceRepository, root: string) {
        const scanned = await this.scan(actor, root);
        return repo.mutate(actor.orgId, state => {
            let added = 0;
            for (const doc of scanned.documents) {
                const previous = state.documents.filter(d => d.sourcePath === doc.sourcePath).sort((a, b) => b.revision - a.revision)[0];
                if (previous?.contentHash === doc.contentHash)
                    continue;
                state.documents.push({ ...doc, id: randomUUID(), documentId: previous?.documentId ?? randomUUID(), orgId: actor.orgId, stagedBy: actor.id, revision: (previous?.revision ?? 0) + 1,
                    status: 'DRAFT', approvedBy: null, approvedAt: null, effectiveFrom: null, effectiveTo: null, departmentIds: [], rule: null });
                added++;
            }
            audit(state, actor, 'KNOWLEDGE_DRAFT_SYNC', 'vault', { added, coverage: scanned.coverage });
            return { added, issues: scanned.issues, coverage: scanned.coverage };
        });
    }
}
function validRule(value: Rule): Rule {
    if (value && Object.keys(value).some(key => !['id', 'type', 'matchTerms', 'conflictGroup', 'slaSeconds', 'careIntervalDays'].includes(key)))
        throw new QcError('UNSUPPORTED_RULE_METADATA');
    if (!value || typeof value.id !== 'string' || !/^[\w.-]{1,100}$/.test(value.id) || !ANALYSIS_TYPES.includes(value.type) || !Array.isArray(value.matchTerms) || value.matchTerms.length > 30 || value.matchTerms.some(t => typeof t !== 'string' || !t.trim() || t.length > 100))
        throw new QcError('INVALID_APPROVED_RULE');
    if (value.conflictGroup !== null && (typeof value.conflictGroup !== 'string' || value.conflictGroup.length > 100))
        throw new QcError('INVALID_CONFLICT_GROUP');
    for (const [v, max] of [[value.slaSeconds, 86400 * 30], [value.careIntervalDays, 3650]] as const)
        if (v !== null && (!Number.isInteger(v) || v <= 0 || v > max))
            throw new QcError('INVALID_RULE_THRESHOLD');
    return structuredClone(value);
}
export class KnowledgeApprovalService {
    constructor(private repo: WorkspaceRepository) { }
    publish(actor: Actor, id: string, input: {
        hash: string;
        effectiveFrom: string;
        effectiveTo: string | null;
        departmentIds: string[];
        rule: Rule;
    }) {
        demand(actor, 'approve');
        const rule = validRule(input.rule), from = publicationInstant(input.effectiveFrom), to = input.effectiveTo === null ? null : publicationInstant(input.effectiveTo);
        if (to && to <= from)
            throw new QcError('INVALID_EFFECTIVE_INTERVAL');
        if (!Array.isArray(input.departmentIds) || input.departmentIds.some(d => typeof d !== 'string' || !d))
            throw new QcError('INVALID_DOCUMENT_ACL');
        if (!actor.permissions.includes('view_all') && (!input.departmentIds.length || input.departmentIds.some(d => !actor.departmentIds.includes(d))))
            throw new QcError('DOCUMENT_SCOPE_APPROVAL_FORBIDDEN', 403);
        return this.repo.mutate(actor.orgId, state => {
            const doc = state.documents.find(d => d.id === id && d.orgId === actor.orgId);
            if (!doc || !canReadDocument(actor, doc))
                throw new QcError('DOCUMENT_NOT_FOUND', 404);
            if (doc.status !== 'DRAFT' || doc.contentHash !== input.hash || digest(doc.markdown) !== input.hash)
                throw new QcError('REVISION_OR_HASH_CONFLICT', 409);
            if (state.documents.some(d => d.documentId === doc.documentId && d.approvedAt && d.revision >= doc.revision))
                throw new QcError('STALE_PUBLICATION_REVISION', 409);
            if (state.documents.some(d => d.documentId === doc.documentId && d.approvedAt && d.effectiveFrom && d.effectiveFrom >= from && !cancelledSchedule(d)))
                throw new QcError('REVISION_EFFECTIVE_ORDER_CONFLICT', 409);
            const conflicts = state.documents.some(d => d.documentId !== doc.documentId && d.synthetic === doc.synthetic && d.approvedAt && d.status !== 'DRAFT' && !cancelledSchedule(d) && d.rule &&
                (d.rule.id === rule.id || rule.conflictGroup && d.rule.conflictGroup === rule.conflictGroup) &&
                (!revisionEnd(state, d) || revisionEnd(state, d)! > from) && (!to || !d.effectiveFrom || d.effectiveFrom < to) &&
                (!d.departmentIds.length || !input.departmentIds.length || d.departmentIds.some(v => input.departmentIds.includes(v))));
            if (conflicts)
                throw new QcError('CONFLICTING_APPROVED_DOCUMENTS', 409);
            // Keep publication metadata intact. The effective timeline chooses the
            // winner without rewriting old versions or stored evidence snapshots.
            Object.assign(doc, { status: 'APPROVED', approvedBy: actor.id, approvedAt: new Date().toISOString(), revokedAt: null, effectiveFrom: from, effectiveTo: to, departmentIds: [...new Set(input.departmentIds)], rule });
            state.authorityEpoch++;
            state.indexVersion++;
            audit(state, actor, 'KNOWLEDGE_PUBLISH', doc.id, { revision: doc.revision, hash: doc.contentHash, authorityEpoch: state.authorityEpoch });
            return doc;
        });
    }
    revoke(actor: Actor, id: string, hash: string) {
        demand(actor, 'approve');
        return this.repo.mutate(actor.orgId, state => {
            const doc = state.documents.find(d => d.id === id && d.orgId === actor.orgId);
            if (!doc || !canReadDocument(actor, doc))
                throw new QcError('DOCUMENT_NOT_FOUND', 404);
            if (doc.status !== 'APPROVED' || doc.contentHash !== hash)
                throw new QcError('REVISION_OR_HASH_CONFLICT', 409);
            doc.status = 'REVOKED';
            doc.revokedAt = new Date().toISOString();
            state.authorityEpoch++;
            state.indexVersion++;
            audit(state, actor, 'KNOWLEDGE_REVOKE', id, { hash, authorityEpoch: state.authorityEpoch });
            return doc;
        });
    }
}
export function verifyCitation(doc: KnowledgeVersion, c: Citation) {
    if (doc.documentId !== c.documentId || doc.revision !== c.revision || doc.contentHash !== c.contentHash || digest(doc.markdown) !== c.contentHash)
        return false;
    const bytes = Buffer.from(doc.markdown, 'utf8');
    if (!Number.isInteger(c.byteStart) || !Number.isInteger(c.byteEnd) || c.byteStart < 0 || c.byteEnd <= c.byteStart || c.byteEnd > bytes.length)
        return false;
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(c.byteStart, c.byteEnd));
        return text === c.quote;
    }
    catch {
        return false;
    }
}
// Historical revisions remain subject to the latest published document ACL.
export function canReadKnowledgeVersionNow(actor: Actor, state: Workspace, doc: KnowledgeVersion) {
    const authority = state.documents.filter(d => d.documentId === doc.documentId && d.approvedAt).sort((a, b) => b.revision - a.revision)[0];
    return canReadDocument(actor, doc) && (!authority || canReadDocument(actor, authority));
}
function publicationInstant(value: string) {
    if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
        throw new QcError('PUBLICATION_TIMEZONE_REQUIRED');
    return iso(value);
}
// A scheduled revision revoked before it starts is a cancellation. Revoking
// an already effective revision blocks fallback; rollback requires a new approval.
function cancelledSchedule(doc: KnowledgeVersion) {
    return doc.status === 'REVOKED' && !!doc.revokedAt && !!doc.effectiveFrom && doc.revokedAt < doc.effectiveFrom;
}
function revisionEnd(state: Workspace, doc: KnowledgeVersion) {
    const next = state.documents.filter(d => d.orgId === doc.orgId && d.documentId === doc.documentId && d.approvedAt && d.effectiveFrom && d.revision > doc.revision && !cancelledSchedule(d))
        .map(d => d.effectiveFrom!).sort()[0];
    return [doc.effectiveTo, next, doc.revokedAt].filter((v): v is string => !!v).sort()[0] ?? null;
}
/** Effective-time lookup under CURRENT ACLs, not a replay of past permissions.
 * Select before filtering expiry/revocation/ACL to prevent older-rule fallback. */
export function effectiveKnowledgeVersions(actor: Actor, state: Workspace, now = new Date(), synthetic = true) {
    const at = now.toISOString(), winners = new Map<string, KnowledgeVersion>();
    for (const doc of state.documents) {
        if (doc.orgId !== actor.orgId || doc.status === 'DRAFT' || !doc.approvedBy || !doc.approvedAt || !doc.effectiveFrom || doc.effectiveFrom > at || cancelledSchedule(doc))continue;
        const old = winners.get(doc.documentId);
        if (!old || doc.revision > old.revision)winners.set(doc.documentId, doc);
    }
    return [...winners.values()].filter(doc =>
        (doc.status !== 'REVOKED' || !!doc.revokedAt && at < doc.revokedAt) &&
        (!doc.effectiveTo || at < doc.effectiveTo) && !!doc.rule &&
        (synthetic || !doc.synthetic) && canReadKnowledgeVersionNow(actor, state, doc));
}
export class KnowledgeRetrievalService {
    retrieve(actor: Actor, state: Workspace, query: string, synthetic: boolean, now?: Date) {
        // Explicit historical timestamps retain legacy approved history for replay.
        // Live analyzer calls omit now and require the current APPROVED status.
        const documents = effectiveKnowledgeVersions(actor, state, now ?? new Date(), synthetic).filter(doc => (now !== undefined || doc.status === 'APPROVED') && digest(doc.markdown) === doc.contentHash);
        const groups = new Set<string>();
        for (const d of documents) {
            const g = d.rule!.conflictGroup;
            if (g && groups.has(g))
                throw new QcError('CONFLICTING_KNOWLEDGE');
            if (g)
                groups.add(g);
        }
        const terms = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
        const chunks: KnowledgeChunk[] = [];
        for (const doc of documents) {
            if (doc.knowledgeClass === 'VERIFIED_LEARNING_CASE') continue;
            // Front matter is untrusted metadata; citations still address original bytes.
            const front = doc.markdown.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/);
            let charOffset = front?.[0].length ?? 0;
            for (const part of doc.markdown.slice(charOffset).matchAll(/[^\n]*(?:\n|$)/g)) {
                const text = part[0];
                if (!text)
                    continue;
                const start = Buffer.byteLength(doc.markdown.slice(0, charOffset), 'utf8');
                charOffset += text.length;
                if (!text.trim())
                    continue;
                let byteOffset = start;
                for (const piece of text.matchAll(/[\s\S]{1,800}/gu)) {
                    const quote = piece[0];
                    const citation: Citation = { documentId: doc.documentId, revision: doc.revision, contentHash: doc.contentHash, byteStart: byteOffset, byteEnd: byteOffset + Buffer.byteLength(quote), quote };
                    byteOffset = citation.byteEnd;
                    if (!verifyCitation(doc, citation))
                        throw new QcError('CITATION_BUILD_FAILED', 500);
                    chunks.push({ versionId: doc.id, rule: doc.rule!, citation });
                }
            }
        }
        const score = (c: KnowledgeChunk) => terms.filter(t => c.citation.quote.toLowerCase().includes(t)).length;
        chunks.sort((a, b) => score(b) - score(a) || a.versionId.localeCompare(b.versionId) || a.citation.byteStart - b.citation.byteStart);
        // Keep coverage of conduct and SLA rules even when product chunks rank higher.
        const chosen: KnowledgeChunk[] = [];
        // Official policy rules keep per-type coverage; verified learning cases are reference material only.
        const policy = new Set(documents.filter(d => d.knowledgeClass !== 'VERIFIED_LEARNING_CASE').map(d => d.id));
        for (const type of ANALYSIS_TYPES) {
            const first = chunks.find(c => c.rule.type === type && policy.has(c.versionId)) ?? chunks.find(c => c.rule.type === type);
            if (first) chosen.push(first);
        }
        for (const chunk of chunks) {
            if (chosen.length >= 12) break;
            if (!chosen.includes(chunk)) chosen.push(chunk);
        }
        const references = documents.filter(d => d.knowledgeClass === 'VERIFIED_LEARNING_CASE').slice(0, 3);
        return { chunks: chosen, references, documents: documents.filter(d => chosen.some(c => c.versionId === d.id) || references.includes(d)) };
    }
}
