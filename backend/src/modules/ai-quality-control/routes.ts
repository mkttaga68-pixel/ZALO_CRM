import { structuredObservations } from './observations.js';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { demand, QcError, type Action, type Actor, type Conversation, type Rule, type Settings, type WorkspaceRepository } from './contracts.js';
import { audit, canReadKnowledgeVersionNow, digest, KnowledgeApprovalService, ObsidianKnowledgeService, verifyCitation } from './knowledge.js';
import { AIProviderService, approvedModel, type ProviderEnvironment } from './providers.js';
import { canReadCurrentRun, ConversationAnalyzerService, EvidenceReviewService, redactPII } from './analysis.js';
import { AIManagerAssistantService, AITrainingCenterService, visibleDataset } from './training.js';
import { CustomerCareMonitoringService, OffDayActivityService } from './analytics.js';
import { SYNTHETIC_SCENARIOS } from './synthetic.js';
import type { QcStorageMode } from './runtime-settings.js';
import { manualSelection } from './manual-real-consent.js';
import { ollamaRuntimeSafety } from './ollama-runtime-safety.js';
import { purgeExpiredRuns } from './retention.js';
import { workspaceCapacity } from './repository.js';
import { registerDepartmentMonitoringConfigRoutes } from './department-monitoring-config.js';
import { registerDepartmentLocalScanRoutes } from './department-local-scan.js';
import { departmentLocalScanGate } from './department-monitoring-validation.js';
import { registerDepartmentObservations } from './department-observations.js';
import { registerDepartmentJobRoutes } from './department-job-routes.js';
import { registerLearningDraftRoutes } from './learning-routes.js';
import { registerCustomerArchiveRoutes } from './customer-archive.js';
import type { LearningNotifier, LearningObsidianOutbox } from './learning-drafts.js';
export interface NativeQcDependencies {
    repo: WorkspaceRepository;
    environment: ProviderEnvironment;
    vault: ObsidianKnowledgeService;
    syntheticVault: string;
    storageMode: QcStorageMode;
    unavailableReason?: string;
    authenticate: preHandlerHookHandler;
    actor: (request: FastifyRequest) => Promise<Actor>;
    validateDepartments: (actor: Actor, ids: string[]) => Promise<void>;
    /** Display names of the actor's own tenant users (UI only; never sent to a model). */
    userNames?: (orgId: string, ids: string[]) => Promise<Record<string, string>>;
    /** First allowlisted vault root of the tenant, used when no vault path was chosen. */
    defaultVault?: (orgId: string) => string | undefined;
    providers?: AIProviderService;
    /** AIQC Nightly Learning: realtime signal to Admins and the authorised Obsidian staging writer (optional). */
    learningNotifier?: LearningNotifier;
    learningOutbox?: LearningObsidianOutbox;
    crm?: {
        list: (actor: Actor, request: FastifyRequest) => Promise<unknown>;
        load: (actor: Actor, id: string, request: FastifyRequest) => Promise<Conversation>;
        /** CRM permission check for one conversation (used by "Lưu trữ tin nhắn"). */
        authorize?: (actor: Actor, id: string, request: FastifyRequest) => Promise<unknown>;
    };
}
const body = (request: FastifyRequest): Record<string, unknown> => { if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body))
    throw new QcError('INVALID_BODY'); return request.body as Record<string, unknown>; };
const param = (r: FastifyRequest) => (r.params as {
    id: string;
}).id;
export function aiQualityControlRoutes(deps: NativeQcDependencies): FastifyPluginAsync {
    return async (app) => {
        app.addHook('preHandler', deps.authenticate);
        const departmentRuntimeAvailable = (actor: Actor) => !deps.unavailableReason && departmentLocalScanGate({deploymentTier:process.env.AI_QC_DEPLOYMENT_TIER,localFlag:process.env.AI_QC_DEPT_MONITOR_LOCAL_TEST_ENABLED,enabled:deps.environment.enabled,realData:deps.environment.realData,manualRetention:!!deps.environment.manualRetention,openAiRemoved:!!deps.environment.openAiRemoved,ollamaEnabled:!!deps.environment.ollamaEnabled,ollamaRealData:!!deps.environment.ollamaRealData,tenantMatches:deps.environment.realDataOrgId===actor.orgId,persistentStorage:deps.storageMode!=='memory'});
        await registerDepartmentMonitoringConfigRoutes(app, { actor: request => deps.actor(request),repo:deps.repo,runtimeAvailable:departmentRuntimeAvailable,moduleAvailable:()=>deps.environment.enabled&&!deps.unavailableReason });
        const providers = deps.providers ?? new AIProviderService(deps.environment), analyzer = new ConversationAnalyzerService(deps.repo, providers, deps.environment);
        const approval = new KnowledgeApprovalService(deps.repo), review = new EvidenceReviewService(deps.repo), training = new AITrainingCenterService(deps.repo, analyzer), manager = new AIManagerAssistantService(deps.repo, providers, deps.environment);
        const run = (action: Action, fn: (actor: Actor, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
            try {
                if (!deps.environment.enabled)
                    throw new QcError('AI_QC_DISABLED', 503);
                const actor = await deps.actor(request);
                demand(actor, action);
                if(deps.unavailableReason)throw new QcError(deps.unavailableReason,503);
                return await fn(actor, request, reply);
            }
            catch (error) {
                const known = error instanceof QcError;
                return reply.code(known ? error.statusCode : 503).send({ error: known ? error.code : 'AI_QC_STORAGE_OR_SERVICE_UNAVAILABLE' });
            }
        };
        const realAccess = async (actor: Actor, request: FastifyRequest, id: string) => { if(deps.environment.authorizedOrgId&&actor.orgId!==deps.environment.authorizedOrgId)throw new QcError('OPENAI_TENANT_NOT_AUTHORIZED',403);if (!deps.environment.realData || !deps.crm)
            throw new QcError('AI_QC_REAL_DATA_DISABLED', 403); if (actor.orgId !== deps.environment.realDataOrgId)
            throw new QcError('AI_QC_REAL_DATA_TENANT_NOT_APPROVED', 403); return deps.crm.load(actor, id, request); };
        await registerLearningDraftRoutes(app, { repo: deps.repo, actor: deps.actor, validateDepartments: deps.validateDepartments, enabled: () => deps.environment.enabled, unavailableReason: deps.unavailableReason, syntheticOnly: !deps.environment.realData, notifier: deps.learningNotifier, outbox: deps.learningOutbox, storageMode: deps.storageMode, realDataOrgId: deps.environment.realDataOrgId });
        await registerCustomerArchiveRoutes(app, { repo: deps.repo, actor: deps.actor, enabled: () => deps.environment.enabled, unavailableReason: deps.unavailableReason,
            realData: () => deps.environment.realData, realDataOrgId: deps.environment.realDataOrgId, authorize: deps.crm?.authorize });
        await registerDepartmentObservations(app,{repo:deps.repo,actor:deps.actor,enabled:()=>deps.environment.enabled&&!deps.unavailableReason,authorizeConversation:(actor,id,request)=>realAccess(actor,request,id)});
        await registerDepartmentJobRoutes(app,{repo:deps.repo,actor:deps.actor,enabled:()=>deps.environment.enabled&&!deps.unavailableReason&&process.env.AI_QC_CONTINUOUS_LOCAL_ENABLED==='true',authorizeConversation:(actor,id,request)=>realAccess(actor,request,id)});
        await registerDepartmentLocalScanRoutes(app, { actor: request => deps.actor(request), environment: deps.environment, repo: deps.repo,
            storageMode: deps.storageMode, unavailableReason: deps.unavailableReason,
            createAnalyzerForTypes: (types, departmentId) => {
                const scopedRepo: WorkspaceRepository = {
                    read: async orgId => { const state = await deps.repo.read(orgId); return { ...state, documents: state.documents.filter(d => d.orgId===orgId && !d.synthetic && d.rule && types.includes(d.rule.type) && (!d.departmentIds.length || d.departmentIds.includes(departmentId))) }; },
                    mutate: <T>(orgId: string, fn: (state: import('./contracts.js').Workspace) => T) => deps.repo.mutate(orgId, fn),
                };
                return new ConversationAnalyzerService(scopedRepo, providers, deps.environment);
            },
            list: (actor, request) => deps.crm ? deps.crm.list(actor, request) : Promise.reject(new QcError('AI_QC_REAL_DATA_DISABLED', 403)),
            load: (actor, id, request) => realAccess(actor, request, id) });
        const allowedCrmRuns = async (actor: Actor, request: FastifyRequest) => {
            const s = await deps.repo.read(actor.orgId), allowed = new Set<string>();
            if (!deps.environment.realData || !deps.crm)
                return allowed;
            for (const r of s.runs.filter(r => r.conversation.source === 'CRM' && canReadCurrentRun(actor, s, r))) {
                try {
                    await realAccess(actor, request, r.conversation.id);
                    allowed.add(r.id);
                }
                catch { /* Fail closed after account/contact permission revocation. */ }
            }
            return allowed;
        };
        const prefix = '/api/v1/ai-quality-control';
        app.get(prefix + '/status', run('access', async (actor) => {
            const s = await deps.repo.read(actor.orgId);
            return { module: 'AI_QUALITY_CONTROL', enabled: true, storageMode: deps.storageMode, syntheticOnly: !deps.environment.realData,
                provider: providers.status(s.settings), manualRealTest: !!deps.environment.manualRealTest&&!!deps.environment.manualRetention&&!!deps.environment.realData&&actor.orgId===deps.environment.authorizedOrgId || !!deps.environment.ollamaRealData&&!!deps.environment.manualRetention&&!!deps.environment.realData&&actor.orgId===deps.environment.realDataOrgId,
                manualProvider: deps.environment.ollamaRealData ? 'ollama' : 'openai', employeeScoring: 'DISABLED', violationConfirmation: 'DISABLED', runtimeIntegration:'EXISTING_CRM_BACKEND',
                availability: { orders: 'NOT_AVAILABLE', assignmentHistory: 'NOT_AVAILABLE', workCalendar: 'NOT_AVAILABLE', syncCoverage: 'UNKNOWN', staffReadEvidence: 'NOT_AVAILABLE' },
                capabilities: { ephemeral: deps.storageMode === 'memory', realApi: deps.environment.realApi, realData: deps.environment.realData }, scenarios: SYNTHETIC_SCENARIOS };
        }));
        app.get(prefix + '/workspace', run('access', async (actor, request) => {
            const s = await deps.repo.read(actor.orgId);
            const q = request.query as Record<string, string>;
            const from = q.from ? Date.parse(q.from) : null, to = q.to ? Date.parse(q.to) : null;
            if (from !== null && !Number.isFinite(from) || to !== null && !Number.isFinite(to))
                throw new QcError('INVALID_FILTER_TIME');
            const crmIds = await allowedCrmRuns(actor, request);
            const runs = s.runs.filter(r => canReadCurrentRun(actor, s, r) && (r.conversation.source !== 'CRM' || crmIds.has(r.id)) && (!q.employeeId || r.conversation.messages.some(m => m.actorId === q.employeeId)) && (from === null || Date.parse(r.createdAt) >= from) && (to === null || Date.parse(r.createdAt) <= to));
            const docs = s.documents.filter(d => canReadKnowledgeVersionNow(actor, s, d));
            const datasets = s.datasets.filter(d => visibleDataset(actor, d));
            const employees = [...new Set(runs.flatMap(r => r.conversation.messages.filter(m => m.role === 'HUMAN' && m.attribution === 'VERIFIED').map(m => m.actorId).filter((v): v is string => !!v)))];
            const employeeNames = deps.userNames && employees.length ? await deps.userNames(actor.orgId, employees).catch(() => ({})) : {};
            const visibleIds = new Set([...runs.map(r => r.id), ...docs.map(d => d.id), ...datasets.map(d => d.id)]);
            return { version: s.version, authorityEpoch: s.authorityEpoch, indexVersion: s.indexVersion,
                settings: { ...s.settings, vaultPath: actor.permissions.includes('edit') ? s.settings.vaultPath || deps.defaultVault?.(actor.orgId) || deps.syntheticVault : '' }, permissions: actor.permissions,
                documents: docs, runs, datasets, evaluations: s.evaluations.filter(e => visibleIds.has(e.datasetId) && visibleIds.has(e.runId)),
                audits: s.audits.filter(a => visibleIds.has(a.resourceId) || actor.permissions.includes('edit') && a.resourceId === 'settings').slice(-100),
                care: new CustomerCareMonitoringService().evaluate(null, null), offDay: runs.map(r => ({ runId: r.id, ...new OffDayActivityService().evaluate(r.conversation) })),
                employees, employeeNames,
                connectionTests: actor.permissions.includes('edit') ? s.audits.filter(a => a.action === 'OPENAI_CONNECTION_TEST').slice(-5) : [],
                capacity: actor.permissions.includes('edit') ? workspaceCapacity(s) : null };
        }));
        app.get(prefix + '/ollama/runtime', run('edit', async () => ollamaRuntimeSafety.metrics()));
        app.put(prefix + '/settings', run('edit', async (actor, request) => {
            const input = body(request);
            if (deps.environment.openAiRemoved && input.provider !== undefined && input.provider === 'openai') throw new QcError('OPENAI_REMOVED', 403);
            const allowed = ['provider', 'model', 'vaultPath', 'maxOutputTokens', 'requestsPerMinute', 'dailyTokenBudget', 'retentionDays', 'inputUsdPerMillion', 'outputUsdPerMillion'];
            if (Object.keys(input).some(key => !allowed.includes(key)))
                throw new QcError('SETTINGS_CONTAIN_UNSUPPORTED_OR_SECRET_FIELDS');
            if (input.provider !== undefined && !['mock', 'openai', 'ollama'].includes(String(input.provider)))
                throw new QcError('INVALID_PROVIDER');
            if (input.model !== undefined && (typeof input.model !== 'string' || input.model !== '' && input.model !== 'qwen3:4b-instruct' && !approvedModel(deps.environment, input.model)))
                throw new QcError('MODEL_CAPABILITY_NOT_APPROVED');
            if (input.vaultPath !== undefined) {
                if (typeof input.vaultPath !== 'string')
                    throw new QcError('INVALID_VAULT_PATH');
                if (input.vaultPath)
                    await deps.vault.validateVaultPath(actor, input.vaultPath);
            }
            for (const [name, min, max] of [['maxOutputTokens', 256, 4096], ['requestsPerMinute', 1, 60], ['dailyTokenBudget', 1000, 1000000]] as const) {
                const value = input[name];
                if (value !== undefined && (!Number.isInteger(value) || Number(value) < min || Number(value) > max))
                    throw new QcError('INVALID_TECHNICAL_BUDGET');
            }
            if ('retentionDays' in input) {
                demand(actor, 'approve');
                if (input.retentionDays !== null && (!Number.isInteger(input.retentionDays) || Number(input.retentionDays) < 1 || Number(input.retentionDays) > 365))
                    throw new QcError('INVALID_RETENTION_DECISION');
            }
            for (const key of ['inputUsdPerMillion', 'outputUsdPerMillion'])
                if (input[key] !== undefined && input[key] !== null && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || Number(input[key]) < 0 || Number(input[key]) > 1000))
                    throw new QcError('INVALID_PRICE_METADATA');
            return deps.repo.mutate(actor.orgId, s => { Object.assign(s.settings, input as Partial<Settings>); if ('retentionDays' in input)
                s.settings.retentionApprovedBy = input.retentionDays === null ? null : actor.id; audit(s, actor, 'SETTINGS_UPDATED', 'settings', { fields: Object.keys(input) }); return { settings: s.settings, provider: providers.status(s.settings) }; });
        }));
        app.post(prefix + '/connection/test', run('edit', async (actor) => analyzer.testConnection(actor)));
        app.post(prefix + '/knowledge/preview', run('edit', async (actor) => { const s = await deps.repo.read(actor.orgId); return deps.vault.scan(actor, s.settings.vaultPath || deps.defaultVault?.(actor.orgId) || deps.syntheticVault); }));
        app.post(prefix + '/knowledge/sync', run('edit', async (actor) => { const s = await deps.repo.read(actor.orgId); return deps.vault.sync(actor, deps.repo, s.settings.vaultPath || deps.defaultVault?.(actor.orgId) || deps.syntheticVault); }));
        app.post(prefix + '/knowledge/:id/publish', run('approve', async (actor, request) => {
            const b = body(request);
            if (!Array.isArray(b.departmentIds) || b.departmentIds.some(v => typeof v !== 'string'))
                throw new QcError('INVALID_DOCUMENT_ACL');
            await deps.validateDepartments(actor, b.departmentIds as string[]);
            return approval.publish(actor, param(request), { hash: String(b.hash ?? ''), effectiveFrom: String(b.effectiveFrom ?? ''), effectiveTo: b.effectiveTo === null ? null : String(b.effectiveTo ?? ''), departmentIds: b.departmentIds as string[], rule: b.rule as Rule });
        }));
        app.post(prefix + '/knowledge/:id/revoke', run('approve', async (actor, request) => approval.revoke(actor, param(request), String(body(request).hash ?? ''))));
        app.post(prefix + '/knowledge/:id/citation', run('access', async (actor, request) => {
            const s = await deps.repo.read(actor.orgId), doc = s.documents.find(d => d.id === param(request));
            if (!doc || !canReadKnowledgeVersionNow(actor, s, doc))
                throw new QcError('DOCUMENT_NOT_FOUND', 404);
            return { valid: verifyCitation(doc, body(request) as never) };
        }));
        app.post(prefix + '/datasets', run('create', async (actor, request) => training.create(actor, body(request) as never)));
        app.post(prefix + '/datasets/:id/labels', run('approve', async (actor, request) => training.label(actor, param(request), body(request) as never)));
        app.post(prefix + '/datasets/:id/analyze', run('create', async (actor, request) => {
            const b = request.body as {
                provider?: unknown;
            } | undefined;
            if (b?.provider !== undefined && !['mock', 'openai', 'ollama'].includes(String(b.provider)))
                throw new QcError('INVALID_PROVIDER');
            const result = await training.analyze(actor, param(request), b?.provider as 'mock' | 'openai' | 'ollama' | undefined);
            return { ...result, observations: structuredObservations(result) };
        }));
        app.post(prefix + '/evaluate', run('approve', async (actor, request) => { const b = body(request); return training.evaluate(actor, String(b.datasetId ?? ''), String(b.runId ?? '')); }));
        app.get(prefix + '/crm/conversations', run('access', async (actor, request) => { if(deps.environment.authorizedOrgId&&actor.orgId!==deps.environment.authorizedOrgId)throw new QcError('OPENAI_TENANT_NOT_AUTHORIZED',403);if (!deps.environment.realData || !deps.crm)
            throw new QcError('AI_QC_REAL_DATA_DISABLED', 403); if (actor.orgId !== deps.environment.realDataOrgId)
            throw new QcError('AI_QC_REAL_DATA_TENANT_NOT_APPROVED', 403); return deps.crm.list(actor, request); }));
        app.post(prefix + '/crm/conversations/:id/preview', run('create',async(actor,request)=>analyzer.previewManual(actor,await realAccess(actor,request,param(request)),manualSelection(body(request)))));
        app.post(prefix + '/crm/conversations/:id/analyze', run('create', async (actor, request) => {
            const input=body(request);
            if(deps.environment.manualRealTest&&input.provider!=='mock'&&input.provider!=='openai')throw new QcError('PROVIDER_SELECTION_REQUIRED');
            if(deps.environment.manualRealTest&&input.provider==='mock')throw new QcError('MANUAL_REAL_TEST_OPENAI_ONLY',403);
            if(input.provider!==undefined&&!['mock','openai','ollama'].includes(String(input.provider)))throw new QcError('PROVIDER_INVALID');
            if((input.provider==='openai'||input.provider==='ollama')&&input.confirmRealData!==true)throw new QcError('MANUAL_REAL_DATA_CONFIRMATION_REQUIRED',403);
            return analyzer.analyze(actor,await realAccess(actor,request,param(request)),input.provider as 'mock'|'openai'|undefined,typeof input.previewToken==='string'?input.previewToken:undefined);
        }));
        app.get(prefix + '/runs/:id', run('access', async (actor, request) => { const r = await review.get(actor, param(request)); if (r.conversation.source === 'CRM')
            await realAccess(actor, request, r.conversation.id); return { ...r, observations: structuredObservations(r) }; }));
        app.post(prefix + '/runs/:id/replay', run('access', async (actor, request) => { const r = await review.get(actor, param(request)); if (r.conversation.source === 'CRM')
            await realAccess(actor, request, r.conversation.id); return review.replay(actor, r.id); }));
        app.post(prefix + '/runs/:id/review', run('approve', async (actor, request) => { const r = await review.get(actor, param(request)); if (r.conversation.source === 'CRM')
            await realAccess(actor, request, r.conversation.id); return review.review(actor, r.id, body(request) as never); }));
        app.post(prefix + '/assistant', run('access', async (actor, request) => { const b = body(request); if (b.provider !== undefined && !['mock', 'openai'].includes(String(b.provider)))
            throw new QcError('INVALID_PROVIDER'); return manager.ask(actor, String(b.question ?? ''), await allowedCrmRuns(actor, request), b.provider as 'mock' | 'openai' | undefined); }));
        app.post(prefix + '/retention/purge-expired', run('delete', async (actor, request) => purgeExpiredRuns(deps.repo, actor, body(request).reason)));
        app.delete(prefix + '/runs/:id', run('delete', async (actor, request) => {
            const input = body(request);
            if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1000)
                throw new QcError('PURGE_REASON_REQUIRED');
            return deps.repo.mutate(actor.orgId, s => {
                const r = s.runs.find(v => v.id === param(request));
                if (!r || !canReadCurrentRun(actor, s, r))
                    throw new QcError('RUN_NOT_FOUND', 404);
                if (!s.settings.retentionDays || !s.settings.retentionApprovedBy)
                    throw new QcError('APPROVED_RETENTION_POLICY_REQUIRED', 403);
                if (Date.now() - Date.parse(r.createdAt) < s.settings.retentionDays * 86400000)
                    throw new QcError('RETENTION_PERIOD_NOT_ELAPSED', 409);
                s.runs = s.runs.filter(v => v.id !== r.id);
                s.evaluations = s.evaluations.filter(v => v.runId !== r.id);
                audit(s, actor, 'RETENTION_PURGE', r.id, { snapshotHash: r.snapshotHash, reason: redactPII(input.reason as string) });
                return { deleted: true, tombstoneHash: digest(r.snapshotHash) };
            });
        }));
    };
}
