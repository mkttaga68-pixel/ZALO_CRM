import { demand, QcError, type Actor, type WorkspaceRepository } from './contracts.js';
import { audit, digest } from './knowledge.js';
import { redactPII } from './analysis.js';

/** Tenant-wide purge of analysis runs whose approved retention period has elapsed.
 * Explicit operator action only (no scheduler). Requires delete + view_all and an approved policy.
 * Writes exactly one audit with a tombstone digest of the purged snapshot hashes; no-op writes nothing. */
export async function purgeExpiredRuns(repo: WorkspaceRepository, actor: Actor, reason: unknown, now = Date.now()) {
    demand(actor, 'delete');
    demand(actor, 'view_all');
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 1000)
        throw new QcError('PURGE_REASON_REQUIRED');
    const expired = (s: Awaited<ReturnType<WorkspaceRepository['read']>>) => {
        const days = s.settings.retentionDays;
        if (!days || !s.settings.retentionApprovedBy)
            throw new QcError('APPROVED_RETENTION_POLICY_REQUIRED', 403);
        const cutoff = now - days * 86400000;
        return { cutoff, ids: s.runs.filter(r => r.orgId === actor.orgId && Date.parse(r.createdAt) <= cutoff).map(r => r.id) };
    };
    const preview = expired(await repo.read(actor.orgId));
    if (!preview.ids.length)
        return { deleted: 0, cutoff: new Date(preview.cutoff).toISOString(), tombstoneHash: null };
    return repo.mutate(actor.orgId, s => {
        const { cutoff, ids } = expired(s), set = new Set(ids);
        const hashes = s.runs.filter(r => set.has(r.id)).map(r => r.snapshotHash).sort();
        s.runs = s.runs.filter(r => !set.has(r.id));
        s.evaluations = s.evaluations.filter(e => !set.has(e.runId));
        const tombstoneHash = digest(hashes.join('\n'));
        audit(s, actor, 'RETENTION_PURGE_BULK', 'retention', { deleted: ids.length, retentionDays: s.settings.retentionDays, cutoff: new Date(cutoff).toISOString(), tombstoneHash, reason: redactPII(reason) });
        return { deleted: ids.length, cutoff: new Date(cutoff).toISOString(), tombstoneHash };
    });
}
