import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { ANALYSIS_TYPES, QcError, demand, type Actor, type Conversation, type WorkspaceRepository } from './contracts.js';
import type { ConversationAnalyzerService } from './analysis.js';
import type { ProviderEnvironment } from './providers.js';
import type { QcStorageMode } from './runtime-settings.js';
import { scopedDepartmentConversation } from './department-scan-scope.js';
import { assertDepartmentScanEnabled, departmentLocalScanGate, type DepartmentScanConfig } from './department-monitoring-validation.js';
import { departmentScanPaused, readDepartmentScanConfig } from './department-monitoring-config.js';
import { audit, digest } from './knowledge.js';
import { observationResult } from './observation-presentation.js';

type Config = DepartmentScanConfig;
type CandidateItem = { id: string; title: string; lastMessageAt: string | null };
type PreviewItem = { conversationId: string; title:string; employees:Array<{id:string;name:string}>; previewToken: string; expiresAt: string; canAnalyze: boolean; blockers: string[]; messages: Array<{id:string;role:string;text:string}>; rules: Array<{id:string;type:string;revision:number;quote:string}> };
const MAX_LOCAL_BATCH = 5;

function assertLocalTest(actor: Actor, request: FastifyRequest, environment: ProviderEnvironment, storageMode: QcStorageMode, unavailableReason?: string) {
  demand(actor, 'create'); demand(actor, 'edit'); demand(actor, 'approve'); demand(actor, 'view_all');
  if (!['owner', 'admin'].includes(request.user.role)) throw new QcError('QC_ORG_ADMIN_REQUIRED', 403);
  if (unavailableReason) throw new QcError(unavailableReason, 503);
  if (!departmentLocalScanGate({ deploymentTier: process.env.AI_QC_DEPLOYMENT_TIER, localFlag: process.env.AI_QC_DEPT_MONITOR_LOCAL_TEST_ENABLED, enabled: environment.enabled, realData: environment.realData, manualRetention: !!environment.manualRetention, openAiRemoved: !!environment.openAiRemoved, ollamaEnabled: !!environment.ollamaEnabled, ollamaRealData: !!environment.ollamaRealData, tenantMatches: environment.realDataOrgId === actor.orgId, persistentStorage: storageMode !== 'memory' }))
    throw new QcError('DEPARTMENT_LOCAL_TEST_NOT_AUTHORIZED', 403);
}

async function configFor(orgId: string, departmentId: string): Promise<Config> {
  const config = await readDepartmentScanConfig(orgId, departmentId);
  assertDepartmentScanEnabled(config, await departmentScanPaused(orgId));
  if (!config.approval_ref || !config.analysis_types.length || !config.recipient_user_ids.length) throw new QcError('DEPARTMENT_MONITOR_CONFIG_INCOMPLETE', 409);
  if (config.analysis_types.some(v => !(ANALYSIS_TYPES as readonly string[]).includes(v))) throw new QcError('DEPARTMENT_MONITOR_CONFIG_INVALID');
  if (config.max_conversations_per_run < 1 || config.max_conversations_per_run > 500 || config.lookback_hours < 1 || config.lookback_hours > 72) throw new QcError('DEPARTMENT_MONITOR_CONFIG_INVALID');
  return config;
}

async function assertApprovedRules(repo: WorkspaceRepository, actor: Actor, departmentId: string, types: string[]) {
  const state = await repo.read(actor.orgId), now = Date.now();
  const requested = new Set(types);
  const eligible = state.documents.filter(d => !d.synthetic && d.status === 'APPROVED' && d.approvedAt && d.effectiveFrom && Date.parse(d.effectiveFrom) <= now && (!d.effectiveTo || Date.parse(d.effectiveTo) > now) && (!d.departmentIds.length || d.departmentIds.includes(departmentId)) && d.rule && requested.has(d.rule.type));
  const covered = new Set<string>(eligible.map(d => d.rule!.type));
  const missing = types.filter(type => !covered.has(type));
  if (missing.length) throw new QcError(`APPROVED_DEPARTMENT_RULES_MISSING:${missing.join(',')}`, 409);
}

async function membership(orgId: string, departmentId: string) {
  const rows = await prisma.departmentMember.findMany({ where: { departmentId, department: { orgId, archivedAt: null }, user: { orgId, isActive: true } }, select: { userId: true } });
  if (!rows.length) throw new QcError('DEPARTMENT_HAS_NO_ACTIVE_MEMBERS', 409);
  return new Set(rows.map(v => v.userId));
}

export async function registerDepartmentLocalScanRoutes(app: FastifyInstance, deps: {
  actor: (request: FastifyRequest) => Promise<Actor>;
  environment: ProviderEnvironment;
  storageMode: QcStorageMode;
  unavailableReason?: string;
  repo: WorkspaceRepository;
  createAnalyzerForTypes: (types: string[], departmentId: string) => ConversationAnalyzerService;
  list: (actor: Actor, request: FastifyRequest) => Promise<unknown>;
  load: (actor: Actor, id: string, request: FastifyRequest) => Promise<Conversation>;
}) {
  const prefix = '/api/v1/ai-quality-control/department-monitoring';
  const respond = (fn: (request: FastifyRequest, actor: Actor, reply: FastifyReply) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
    try { const actor = await deps.actor(request); assertLocalTest(actor, request, deps.environment, deps.storageMode, deps.unavailableReason); return await fn(request, actor, reply); }
    catch (error) { return reply.code(error instanceof QcError ? error.statusCode : 503).send({ error: error instanceof QcError ? error.code : 'DEPARTMENT_LOCAL_SCAN_UNAVAILABLE' }); }
  };
  const department = async (actor: Actor, id: string) => {
    const row = await prisma.department.findFirst({ where: { id, orgId: actor.orgId, archivedAt: null }, select: { id: true, name: true } });
    if (!row) throw new QcError('DEPARTMENT_NOT_FOUND', 404);
    return row;
  };
  const assertNotStopped = async (orgId: string) => {
    const rows = await prisma.$queryRaw<Array<{paused:boolean}>>(Prisma.sql`SELECT paused FROM ai_qc_department_monitor_control WHERE org_id = ${orgId}`);
    if (rows[0]?.paused) throw new QcError('DEPARTMENT_LOCAL_TEST_KILL_SWITCH_ACTIVE', 423);
  };
  const candidatesFor = async (request: FastifyRequest, actor: Actor, departmentId: string, config: Config) => {
    const members = await membership(actor.orgId, departmentId);
    const result = await deps.list(actor, request) as { conversations?: CandidateItem[]; coverage?: string };
    const list = Array.isArray(result?.conversations) ? result.conversations.slice(0, 50) : [];
    const selected: Array<{ item: CandidateItem; conversation: Conversation }> = [];
    for (const item of list) {
      if (!item?.id) continue;
      const loaded = await deps.load(actor, item.id, request);
      const scoped = scopedDepartmentConversation(loaded, departmentId, members, config.lookback_hours);
      if (scoped) {
        scoped.provenanceHash = digest(JSON.stringify({departmentId,version:config.version,members:[...members].sort()}));
        selected.push({ item, conversation: scoped });
      }
      if (selected.length >= Math.min(MAX_LOCAL_BATCH, config.max_conversations_per_run)) break;
    }
    return { selected, coverage: 'LIMITED_TO_50_RECENT_CONVERSATIONS_VISIBLE_TO_REQUESTER', members };
  };
  const employeesFor=async(actor:Actor,conversation:Conversation)=>{
    const ids=[...new Set(conversation.messages.filter(m=>m.role==='HUMAN'&&m.attribution==='VERIFIED'&&m.actorId).map(m=>m.actorId!))];
    return prisma.user.findMany({where:{orgId:actor.orgId,id:{in:ids}},select:{id:true,fullName:true}}).then(rows=>rows.map(u=>({id:u.id,name:u.fullName})));
  };

  app.post(prefix + '/departments/:id/scan-preview', respond(async (request, actor, reply) => {
    const id = (request.params as {id:string}).id;
    await assertNotStopped(actor.orgId);
    const dept = await department(actor, id), config = await configFor(actor.orgId, id);
    await assertApprovedRules(deps.repo, actor, id, config.analysis_types);
    const batch = await candidatesFor(request, actor, id, config), candidates: PreviewItem[] = [];
    const analyzer = deps.createAnalyzerForTypes(config.analysis_types, id);
    for (const {item, conversation} of batch.selected) {
      const preview = await analyzer.previewManual(actor, conversation, { messageLimit: 50, redactions: [] });
      const rules = preview.knowledge.filter(k => config.analysis_types.includes(k.rule.type)).map(k => ({ id: k.rule.id, type: k.rule.type, revision: k.citation.revision, quote: k.citation.quote }));
      const missingTypes = config.analysis_types.filter(type => !rules.some(rule => rule.type === type));
      candidates.push({ conversationId: item.id, title:item.title,employees:await employeesFor(actor,conversation),previewToken: preview.previewToken, expiresAt: preview.expiresAt, canAnalyze: preview.canAnalyze && !missingTypes.length,
        blockers: [...(preview.blockers ?? []), ...(missingTypes.length ? [`APPROVED_DEPARTMENT_RULES_MISSING:${missingTypes.join(',')}`] : [])], messages: preview.conversation.messages, rules });
    }
    return reply.send({ department: dept, count: candidates.length, maximum: Math.min(MAX_LOCAL_BATCH, config.max_conversations_per_run), coverage: batch.coverage,
      lookbackHours: config.lookback_hours, analysisTypes: config.analysis_types, candidates, notice: 'Danh sách chỉ gồm hội thoại CRM người đăng nhập được phép xem; cần xem trước và xác nhận cả lô trước khi gửi Ollama nội bộ.' });
  }));

  app.post(prefix + '/departments/:id/scan', respond(async (request, actor, reply) => {
    const id = (request.params as {id:string}).id, input = request.body as {confirmed?:boolean; items?:Array<{conversationId?:string;previewToken?:string}>}|undefined;
    await assertNotStopped(actor.orgId);
    if (input?.confirmed !== true || !Array.isArray(input.items) || !input.items.length || input.items.length > MAX_LOCAL_BATCH || input.items.some(v => typeof v.conversationId !== 'string' || typeof v.previewToken !== 'string')) throw new QcError('DEPARTMENT_SCAN_CONFIRMATION_REQUIRED', 403);
    const dept = await department(actor, id), config = await configFor(actor.orgId, id);
    await assertApprovedRules(deps.repo, actor, id, config.analysis_types);
    if (input.items.length > Math.min(MAX_LOCAL_BATCH, config.max_conversations_per_run) || new Set(input.items.map(v => v.conversationId)).size !== input.items.length) throw new QcError('DEPARTMENT_SCAN_BATCH_LIMIT');
    const batch = await candidatesFor(request, actor, id, config), available = new Map(batch.selected.map(v => [v.item.id, v.conversation]));
    const analyzer = deps.createAnalyzerForTypes(config.analysis_types, id), results = [];
    for (const item of input.items) {
      const candidate=batch.selected.find(v=>v.item.id===item.conversationId);
      const display={conversationId:item.conversationId,title:candidate?.item.title??'Hội thoại không còn trong phạm vi',employees:candidate?await employeesFor(actor,candidate.conversation):[]};
      try {
      const currentActor = await deps.actor(request);
      assertLocalTest(currentActor, request, deps.environment, deps.storageMode, deps.unavailableReason);
      const latest = await readDepartmentScanConfig(actor.orgId, id);
      assertDepartmentScanEnabled(latest, await departmentScanPaused(actor.orgId), config.version);
      await department(actor, id);
      const members = await membership(actor.orgId, id);
      const reloaded = available.has(item.conversationId!) ? await deps.load(currentActor,item.conversationId!,request) : null;
      const conversation = reloaded ? scopedDepartmentConversation(reloaded,id,members,config.lookback_hours) : null;
      if (conversation) conversation.provenanceHash=digest(JSON.stringify({departmentId:id,version:config.version,members:[...members].sort()}));
      if (!conversation) { results.push({ ...display, error: 'DEPARTMENT_MEMBERSHIP_OR_CONVERSATION_SCOPE_CHANGED' }); continue; }
        const run = await analyzer.analyze(currentActor, conversation, 'ollama', item.previewToken);
        await deps.repo.mutate(actor.orgId,s=>{const stored=s.runs.find(r=>r.id===run.id);if(!stored)throw new QcError('RUN_NOT_FOUND',404);stored.departmentObservation={departmentId:id,recipientUserIds:[...config.recipient_user_ids],seenBy:[]};audit(s,currentActor,'DEPARTMENT_OBSERVATION_CREATED',run.id,{departmentId:id,recipients:config.recipient_user_ids});});
        const names=Object.fromEntries((await employeesFor(actor,conversation)).map(u=>[u.id,u.name]));
        results.push({ ...display,...observationResult(run,names) });
      } catch (error) { results.push({ ...display, error: error instanceof QcError ? error.code : 'ANALYSIS_FAILED' }); }
    }
    return reply.send({ department: dept, provider: 'ollama-local', processed: results.filter(v => 'status' in v && v.status==='COMPLETED').length, results, reviewRequired: true,
      notice: 'Nhận xét cần được đối chiếu bằng chứng trước khi xử lý.' });
  }));
}
