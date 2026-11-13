import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { demand, QcError, type Action, type Actor, type WorkspaceRepository } from './contracts.js';
import { LearningDraftService, learningHealth, localClock, nightlyDue, nightlyLearningGate, purgeLearningDrafts, runNightlyLearning, type LearningNotifier, type LearningObsidianOutbox } from './learning-drafts.js';

export interface LearningRouteDeps {
    repo: WorkspaceRepository;
    actor: (request: FastifyRequest) => Promise<Actor>;
    validateDepartments: (actor: Actor, ids: string[]) => Promise<void>;
    enabled: () => boolean;
    unavailableReason?: string;
    /** True only while the module runs without real CRM data (sandbox). Enables the synthetic nightly trigger. */
    syntheticOnly: boolean;
    notifier?: LearningNotifier;
    outbox?: LearningObsidianOutbox;
    /** Inputs for the activation-gate view in the Admin health endpoint (same evaluation as the scheduler). */
    storageMode?: string;
    realDataOrgId?: string;
    env?: NodeJS.ProcessEnv;
}
export const learningGateFromEnv = (env: NodeJS.ProcessEnv, storageMode: string | undefined, realDataOrgId: string | undefined) => nightlyLearningGate({ enabled: env.AI_QC_NIGHTLY_LEARNING_ENABLED, schedule: env.AI_QC_NIGHTLY_LEARNING_SCHEDULE, timeZone: env.AI_QC_NIGHTLY_LEARNING_TZ,
    scopeApproval: env.AI_QC_NIGHTLY_LEARNING_SCOPE_APPROVAL, deploymentTier: env.AI_QC_DEPLOYMENT_TIER, productionGo: env.AI_QC_PRODUCTION_GO_APPROVED, realDataOrgId, storageMode, nodeEnv: env.NODE_ENV });
const body = (r: FastifyRequest) => { if (!r.body || typeof r.body !== 'object' || Array.isArray(r.body)) throw new QcError('INVALID_BODY'); return r.body as Record<string, unknown>; };
const id = (r: FastifyRequest) => (r.params as { id: string }).id;

export async function registerLearningDraftRoutes(app: FastifyInstance, deps: LearningRouteDeps) {
    const service = new LearningDraftService(deps.repo, deps.validateDepartments, deps.notifier, deps.outbox);
    const run = (action: Action, fn: (actor: Actor, request: FastifyRequest) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            if (!deps.enabled()) throw new QcError('AI_QC_DISABLED', 503);
            const actor = await deps.actor(request);
            demand(actor, action);
            if (deps.unavailableReason) throw new QcError(deps.unavailableReason, 503);
            return await fn(actor, request);
        }
        catch (error) {
            const known = error instanceof QcError;
            const checks = known ? (error as QcError & { checks?: unknown }).checks : undefined;
            return reply.code(known ? error.statusCode : 503).send({ error: known ? error.code : 'AI_QC_STORAGE_OR_SERVICE_UNAVAILABLE', ...(checks ? { checks } : {}) });
        }
    };
    const p = '/api/v1/ai-quality-control/learning-drafts';
    app.get(p + '/summary', run('approve', actor => service.summary(actor)));
    /** Monitoring snapshot (approve + view_all): scheduler gate, last job, capacity, outbox, alerts. Counts and codes only. */
    app.get(p + '/health', run('approve', async actor => learningHealth(actor, await deps.repo.read(actor.orgId), { gate: learningGateFromEnv(deps.env ?? process.env, deps.storageMode, deps.realDataOrgId),
        outboxConfigured: !!deps.outbox, realtime: !!deps.notifier, storageMode: deps.storageMode ?? 'unknown' })));
    app.get(p, run('approve', (actor, r) => { const s = (r.query as Record<string, string>).status; return service.list(actor, typeof s === 'string' && s ? s : undefined); }));
    app.get(p + '/:id', run('approve', (actor, r) => service.get(actor, id(r))));
    app.post(p + '/:id/verify-scope', run('approve', (actor, r) => service.verifyScope(actor, id(r), body(r).expectedRevision)));
    app.post(p + '/:id/approve', run('approve', (actor, r) => { const b = body(r); return service.approve(actor, id(r), { expectedRevision: b.expectedRevision, contentHash: b.contentHash, confirm: b.confirm }); }));
    app.post(p + '/:id/reject', run('approve', (actor, r) => { const b = body(r); return service.reject(actor, id(r), { expectedRevision: b.expectedRevision, reason: b.reason }); }));
    app.post(p + '/:id/request-changes', run('approve', (actor, r) => { const b = body(r); return service.requestChanges(actor, id(r), { expectedRevision: b.expectedRevision, note: b.note }); }));
    app.post(p + '/:id/revise', run('edit', (actor, r) => { const b = body(r); return service.revise(actor, id(r), { expectedRevision: b.expectedRevision, title: b.title, rationale: b.rationale }); }));
    app.post(p + '/purge-expired', run('delete', (actor, r) => purgeLearningDrafts(deps.repo, actor, body(r).reason, Date.now(), deps.notifier)));
    /** Sandbox-only trigger: mines SYNTHETIC runs only; refused whenever real CRM data is enabled. */
    app.post(p + '/sandbox/nightly-run', run('approve', async actor => {
        demand(actor, 'edit'); demand(actor, 'view_all');
        if (!deps.syntheticOnly) throw new QcError('LEARNING_SANDBOX_TRIGGER_DISABLED_WITH_REAL_DATA', 403);
        return runNightlyLearning(deps.repo, { orgId: actor.orgId, scope: { departmentIds: null, synthetic: true }, localDate: 'sandbox-' + new Date().toISOString(), force: true, outbox: deps.outbox, notifier: deps.notifier });
    }));
}

/** Socket.IO namespace `/aiqc-learning`: Admins (approve) join their tenant room and receive a content-free
 * "changed" signal; clients re-fetch through the authorised REST API, so no draft content travels over the socket. */
export function socketLearningNotifier(io: Server, authenticate: (socket: Socket) => Promise<Actor>, repo?: WorkspaceRepository): LearningNotifier {
    const ns = io.of('/aiqc-learning');
    ns.use((socket, next) => {
        void authenticate(socket).then(actor => {
            if (!actor.permissions.includes('access') || !actor.permissions.includes('approve')) throw new QcError('QC_FORBIDDEN', 403);
            socket.data.learningOrg = actor.orgId; void socket.join('org:' + actor.orgId); next();
        }).catch(() => next(new Error('UNAUTHORIZED')));
    });
    ns.on('connection', socket => {
        // Re-check the principal: revoked permission or tenant change disconnects the socket.
        const timer = setInterval(() => { void authenticate(socket).then(a => { if (a.orgId !== socket.data.learningOrg || !a.permissions.includes('access') || !a.permissions.includes('approve')) socket.disconnect(true); }).catch(() => socket.disconnect(true)); }, 30000);
        timer.unref?.();
        socket.once('disconnect', () => clearInterval(timer));
    });
    const deliver = async (orgId: string, event: Parameters<LearningNotifier['changed']>[1]) => {
        // Reauthorize each recipient at delivery; do not rely on a stale room subscription.
        // Direct emission also avoids the CRM adapter, which only understands legacy module events.
        for (const socket of ns.sockets.values()) if (socket.data.learningOrg === orgId) {
            try { const actor = await authenticate(socket); if (actor.orgId !== orgId || !actor.permissions.includes('access') || !actor.permissions.includes('approve')) { socket.disconnect(true); continue; }
                socket.emit('aiqc:learning-drafts-changed', { draftId: event.draftId, status: event.status, revision: event.revision, reason: event.reason, at: new Date().toISOString() });
            } catch { socket.disconnect(true); }
        }
    };
    // Durable workspace versions bridge backend instances without sending content through PostgreSQL events.
    const versions = new Map<string, number>(); let polling = false;
    const poll = repo ? setInterval(() => { if (polling) return; polling = true;
        void (async () => { const orgs = new Set([...ns.sockets.values()].map(s => s.data.learningOrg as string));
            for (const org of [...versions.keys()]) if (!orgs.has(org)) versions.delete(org);
            for (const org of orgs) { const version = repo.version ? await repo.version(org) : (await repo.read(org)).version; const old = versions.get(org); versions.set(org, version);
                if (old !== undefined && old !== version) await deliver(org, { draftId: null, status: null, revision: null, reason: 'WORKSPACE_CHANGED' }); }
        })().catch(() => {}).finally(() => { polling = false; });
    }, 5000) : undefined; poll?.unref();
    return { changed: (orgId, event) => { void deliver(orgId, event); }, close: () => { if (poll) clearInterval(poll); } };
}

/** Scheduler is registered only when the activation gate passes; otherwise it logs blockers and does nothing. */
export function registerNightlyLearningScheduler(app: FastifyInstance, repo: WorkspaceRepository, options: { storageMode: string; realDataOrgId?: string; notifier?: LearningNotifier; outbox?: LearningObsidianOutbox; env?: NodeJS.ProcessEnv }) {
    const env = options.env ?? process.env;
    const gate = learningGateFromEnv(env, options.storageMode, options.realDataOrgId);
    if (!gate.allowed || !gate.schedule || !gate.scope) {
        if (env.AI_QC_NIGHTLY_LEARNING_ENABLED === 'true') app.log.warn({ blockers: gate.blockers }, 'AIQC nightly learning not started');
        else app.log.info({ blockers: gate.blockers }, 'AIQC nightly learning disabled');
        return { started: false, blockers: gate.blockers };
    }
    const { schedule, scope } = gate;
    let running = false;
    const tick = async () => {
        const now = new Date();
        if (running || !nightlyDue(now, schedule)) return;
        running = true;
        try {
            const r = await runNightlyLearning(repo, { orgId: scope.orgId, scope: { departmentIds: scope.departmentIds, synthetic: false }, localDate: localClock(now, schedule.timeZone).date, now, outbox: options.outbox, notifier: options.notifier });
            // Structured, content-free log line for monitoring (one per local date; skipped runs are debug-level).
            if (r.skipped) app.log.debug({ skipped: r.skipped }, 'AIQC nightly learning skipped');
            else app.log.info({ jobId: r.jobId, created: r.created, merged: r.merged, suppressed: r.suppressed, expired: r.expired }, 'AIQC nightly learning completed');
        }
        catch (error) { app.log.error({ code: error instanceof QcError ? error.code : 'NIGHTLY_LEARNING_FAILED' }, 'AIQC nightly learning failed'); }
        finally { running = false; }
    };
    const timer = setInterval(() => void tick(), 5 * 60000); timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
    app.log.info({ schedule, departments: scope.departmentIds.length, reference: scope.reference }, 'AIQC nightly learning scheduler started');
    return { started: true, blockers: [] as string[] };
}
