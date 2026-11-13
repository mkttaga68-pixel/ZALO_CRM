import { Prisma } from '@prisma/client';
import { clone, initialWorkspace, QcError, type Workspace, type WorkspaceRepository } from './contracts.js';
export const WORKSPACE_LIMITS = { documents: 1000, runs: 500, datasets: 500, audits: 10000, bytes: 8 * 1024 * 1024 } as const;
/** Hard ceiling for audit rows. Only a capacity-relief mutation (see `bounded`) may exceed the soft audit limit. */
export const AUDIT_HARD_LIMIT = WORKSPACE_LIMITS.audits + 500;
export function workspaceCapacity(state: Workspace) {
    const bytes = Buffer.byteLength(JSON.stringify(state));
    return { limits: { ...WORKSPACE_LIMITS, auditHardLimit: AUDIT_HARD_LIMIT },
        used: { documents: state.documents.length, runs: state.runs.length, datasets: state.datasets.length, audits: state.audits.length, bytes },
        atCapacity: state.documents.length >= WORKSPACE_LIMITS.documents || state.runs.length >= WORKSPACE_LIMITS.runs || state.datasets.length >= WORKSPACE_LIMITS.datasets || state.audits.length >= WORKSPACE_LIMITS.audits || bytes >= WORKSPACE_LIMITS.bytes };
}
/** Rejects growth beyond the limits. A mutation that strictly reduces stored bytes and adds no
 * documents/runs/datasets (e.g. a retention purge) may still append its own audit up to
 * AUDIT_HARD_LIMIT, so purging can never deadlock when the audit log reaches its soft limit. */
function bounded(state: Workspace, original?: Workspace) {
    const L = WORKSPACE_LIMITS, bytes = Buffer.byteLength(JSON.stringify(state));
    if (state.documents.length <= L.documents && state.runs.length <= L.runs && state.datasets.length <= L.datasets && state.audits.length <= L.audits && bytes <= L.bytes)
        return;
    if (original && state.documents.length <= Math.min(L.documents, original.documents.length) && state.runs.length <= Math.min(L.runs, original.runs.length) &&
        state.datasets.length <= Math.min(L.datasets, original.datasets.length) && state.audits.length <= AUDIT_HARD_LIMIT && bytes <= L.bytes &&
        bytes < Buffer.byteLength(JSON.stringify(original)))
        return;
    throw new QcError('WORKSPACE_CAPACITY_REQUIRES_RETENTION_REVIEW', 409);
}
/** Explicitly ephemeral synthetic-only implementation for development/tests. */
export class MemoryWorkspaceRepository implements WorkspaceRepository {
    private states = new Map<string, Workspace>();
    async read(orgId: string) { return clone(this.states.get(orgId) ?? initialWorkspace()); }
    async mutate<T>(orgId: string, fn: (state: Workspace) => T): Promise<T> {
        const original = this.states.get(orgId) ?? initialWorkspace();
        const state = clone(original);
        const result = fn(state);
        if (result instanceof Promise)
            throw new QcError('ASYNC_WORKSPACE_MUTATION_FORBIDDEN', 500);
        state.version++;
        bounded(state, original);
        this.states.set(orgId, clone(state));
        return clone(result);
    }
    async version(orgId: string) { return this.states.get(orgId)?.version ?? 0; }
}
// Minimal structural contract also accepts the existing extended Prisma client.
export interface WorkspaceDatabase {
    nativeAiQcWorkspace: {findUnique(args:{where:{organizationId:string};select?:{version:true}}):PromiseLike<{payload?:Prisma.JsonValue;version?:number}|null>};
    $transaction<T>(fn:(tx:{nativeAiQcWorkspace:{
        upsert(args:Prisma.NativeAiQcWorkspaceUpsertArgs):PromiseLike<unknown>;
        findUniqueOrThrow(args:{where:{organizationId:string}}):PromiseLike<{payload:Prisma.JsonValue;version:number}>;
        updateMany(args:Prisma.NativeAiQcWorkspaceUpdateManyArgs):PromiseLike<{count:number}>;
    }})=>Promise<T>,options:{isolationLevel:Prisma.TransactionIsolationLevel}):Promise<T>;
}
/** PostgreSQL-backed workspace, atomic publication/review/audit with optimistic versioning.
 * May use the existing application client after explicit feature migration. */
export class PrismaWorkspaceRepository implements WorkspaceRepository {
    constructor(private db: WorkspaceDatabase) { }
    async read(orgId: string) {
        try{const row = await this.db.nativeAiQcWorkspace.findUnique({ where: { organizationId: orgId } }); return row ? row.payload as unknown as Workspace : initialWorkspace();}
        catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2021','P2022'].includes(error.code))throw new QcError('AI_QC_SCHEMA_NOT_READY',503);throw error;}
    }
    /** Version column only — used by the realtime bridge so polling never transfers the (up to 8 MB) payload. */
    async version(orgId: string) {
        try{const row = await this.db.nativeAiQcWorkspace.findUnique({ where: { organizationId: orgId }, select: { version: true } }); return row?.version ?? 0;}
        catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2021','P2022'].includes(error.code))throw new QcError('AI_QC_SCHEMA_NOT_READY',503);throw error;}
    }
    async mutate<T>(orgId: string, fn: (state: Workspace) => T): Promise<T> {
        try {
            return await this.db.$transaction(async (tx) => {
                await tx.nativeAiQcWorkspace.upsert({ where: { organizationId: orgId }, create: { organizationId: orgId, payload: initialWorkspace() as unknown as Prisma.InputJsonValue }, update: {} });
                const row = await tx.nativeAiQcWorkspace.findUniqueOrThrow({ where: { organizationId: orgId } });
                const state = clone(row.payload as unknown as Workspace);
                const result = fn(state);
                if (result instanceof Promise)
                    throw new QcError('ASYNC_WORKSPACE_MUTATION_FORBIDDEN', 500);
                state.version++;
                bounded(state, row.payload as unknown as Workspace);
                const changed = await tx.nativeAiQcWorkspace.updateMany({ where: { organizationId: orgId, version: row.version }, data: { version: { increment: 1 }, payload: state as unknown as Prisma.InputJsonValue } });
                if (changed.count !== 1)
                    throw new QcError('WORKSPACE_CONFLICT', 409);
                return result;
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        }
        catch (error) {
            if(error instanceof Prisma.PrismaClientKnownRequestError&&['P2021','P2022'].includes(error.code))throw new QcError('AI_QC_SCHEMA_NOT_READY',503);
            // P2034: serialization failure; P2002: two transactions created the same missing workspace row concurrently.
            if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002'))
                throw new QcError('WORKSPACE_CONFLICT', 409);
            throw error;
        }
    }
}
