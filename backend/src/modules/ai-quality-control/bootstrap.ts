import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { userHasGrant } from '../rbac/permission-group-service.js';
import { MemoryWorkspaceRepository, PrismaWorkspaceRepository } from './repository.js';
import { providerEnvironment } from './providers.js';
import { ObsidianKnowledgeService } from './knowledge.js';
import { aiQualityControlRoutes } from './routes.js';
import { CrmConversationReadAdapter } from './crm-adapter.js';
import { QcError, type Action } from './contracts.js';
import {qcStorageMode,type QcStorageMode} from './runtime-settings.js';
import type { Server } from 'socket.io';
import { assertActiveSession } from '../auth/active-session.js';
import { LearningObsidianOutbox } from './learning-drafts.js';
import { registerNightlyLearningScheduler, socketLearningNotifier } from './learning-routes.js';
async function resolveQcActor(userId: string, orgId: string) {
    const permissions: Action[] = [];
    for (const action of ['access', 'create', 'edit', 'approve', 'delete', 'view_all'] as const)
        if (await userHasGrant(userId, 'ai_quality_control', action))
            permissions.push(action);
    const memberships = await prisma.departmentMember.findMany({ where: { userId, department: { orgId } }, select: { departmentId: true } });
    return { id: userId, orgId, permissions, departmentIds: memberships.map(v => v.departmentId) };
}
export async function registerNativeAiQualityControl(app: FastifyInstance) {
    const environment = providerEnvironment();
    const syntheticVault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/ai-quality-control/vault');
    let mode:QcStorageMode='memory',unavailableReason:string|undefined;
    try{mode=qcStorageMode();}catch(error){unavailableReason=error instanceof QcError?error.code:'AI_QC_STORAGE_CONFIG_INVALID';}
    let repo: MemoryWorkspaceRepository | PrismaWorkspaceRepository = new MemoryWorkspaceRepository();
    if (mode==='application')repo=new PrismaWorkspaceRepository(prisma);
    // A disabled module never connects to a separate store during CRM startup.
    if (environment.enabled && mode === 'postgres-sandbox') {
      let sandboxClient:PrismaClient|undefined;
      try {
        const raw = process.env.AI_QC_SANDBOX_DATABASE_URL;
        if (!raw)
            throw new Error('Separate AI_QC_SANDBOX_DATABASE_URL required');
        const url = new URL(raw), name = decodeURIComponent(url.pathname.slice(1));
        if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/^ai_qc_sandbox_[a-z0-9_]+$/.test(name) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
            throw new Error('QC storage requires a named loopback sandbox database');
        if (process.env.DATABASE_URL && decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) === name)
            throw new Error('QC sandbox must differ from application database');
        const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: raw }), log: [] });
        sandboxClient=client;
        const actual = await client.$queryRaw<Array<{
            name: string;
        }>> `SELECT current_database() AS name`;
        if (actual[0]?.name !== name) {
            await client.$disconnect();
            throw new Error('QC sandbox database identity mismatch');
        }
        repo = new PrismaWorkspaceRepository(client);
        app.addHook('onClose', () => client.$disconnect());
      }catch{await sandboxClient?.$disconnect().catch(()=>{});unavailableReason='AI_QC_SANDBOX_STORAGE_UNAVAILABLE';}
    }
    let roots: Record<string, string[]> = {};
    try {
        const parsed = JSON.parse(process.env.AI_QC_VAULT_ROOTS_BY_TENANT ?? '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
            roots = parsed;
    }
    catch {
        unavailableReason='AI_QC_VAULT_ALLOWLIST_INVALID';
    }
    const vault = new ObsidianKnowledgeService(org => [syntheticVault, ...(Array.isArray(roots[org]) ? roots[org]!.filter(v => typeof v === 'string' && path.isAbsolute(v)) : [])], syntheticVault);
    const adapter = new CrmConversationReadAdapter(app, () => environment.realData);
    // AIQC Nightly Learning: content-free realtime signal + authorised writer to a staging folder that is NOT the read-only vault mount.
    const io = (app as FastifyInstance & { io?: Server }).io;
    const learningNotifier = io ? socketLearningNotifier(io, async socket => {
        const token = socket.handshake.auth?.token;
        if (typeof token !== 'string') throw new QcError('UNAUTHORIZED', 401);
        const claims = app.jwt.verify<{ id: string; orgId: string; role: string; credentialVersion: string }>(token);
        // Same rule as the main namespace: a signed token without id/orgId is never a principal.
        if (!claims?.id || !claims?.orgId) throw new QcError('UNAUTHORIZED', 401);
        await assertActiveSession(claims);
        return resolveQcActor(claims.id, claims.orgId);
    }, repo) : undefined;
    if (learningNotifier) app.addHook('onClose', async () => learningNotifier.close?.());
    const outboxDir = process.env.AI_QC_LEARNING_OUTBOX_DIR;
    const learningOutbox = outboxDir ? new LearningObsidianOutbox(outboxDir, [syntheticVault, ...Object.values(roots).flat().filter((v): v is string => typeof v === 'string')]) : undefined;
    await app.register(aiQualityControlRoutes({ repo, environment, vault, syntheticVault, storageMode:mode,unavailableReason, authenticate: authMiddleware,
        actor: async (request) => resolveQcActor(request.user.id, request.user.orgId),
        learningNotifier, learningOutbox,
        validateDepartments: async (actor, ids) => { const distinct = [...new Set(ids)]; if (distinct.length !== await prisma.department.count({ where: { id: { in: distinct }, orgId: actor.orgId } }))
            throw new QcError('DEPARTMENT_NOT_IN_TENANT', 403); },
        crm: { list: (actor, request) => adapter.list(actor, request), load: (actor, id, request) => adapter.load(actor, id, request), authorize: (actor, id, request) => adapter.authorize(actor, id, request) },
        defaultVault: org => (Array.isArray(roots[org]) ? roots[org]!.find(v => typeof v === 'string' && path.isAbsolute(v)) : undefined),
        userNames: async (orgId, ids) => Object.fromEntries((await prisma.user.findMany({ where: { orgId, id: { in: ids.slice(0, 500) } }, select: { id: true, fullName: true, email: true } })).map(u => [u.id, u.fullName || u.email])),
    }));
    if(process.env.AI_QC_AUTO_MONITOR_ENABLED==='true') {
        const {registerMonitoringSandbox}=await import('./monitoring/runtime.js');
        await registerMonitoringSandbox(app,repo);
    }
    const retentionOrg=environment.authorizedOrgId??environment.realDataOrgId;
    if (environment.enabled && !unavailableReason)
        registerNightlyLearningScheduler(app, repo, { storageMode: mode, realDataOrgId: environment.realDataOrgId, notifier: learningNotifier, outbox: learningOutbox });
    if(process.env.AI_QC_CONTINUOUS_LOCAL_ENABLED==='true'){
        if(mode!=='application'||unavailableReason)throw new QcError('CONTINUOUS_STORAGE_REQUIRED',503);
        const {registerContinuousLocal}=await import('./continuous-runtime.js');
        await registerContinuousLocal(app,repo,environment,adapter);
    }
    if(process.env.AI_QC_MANUAL_RETENTION_ENABLED==='true'&&retentionOrg){
        const {registerManualRetention}=await import('./manual-retention.js');
        await registerManualRetention(app,repo,retentionOrg);
    }
}
