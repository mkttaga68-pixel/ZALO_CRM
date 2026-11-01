import type { FastifyInstance, FastifyReply } from 'fastify';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { postingAccounts, postingTargets, requirePostingAccount } from './access.js';
import { PostingError, type PostingJob, type PostingViewer } from './contracts.js';
import { ManualPostingStore } from './store.js';
import { postingId, postingKind, validatePostingDraft } from './validation.js';
import { ManualPostingWorker } from './worker.js';

function dto(job: PostingJob & { total?: number; sent?: number; unknown?: number }) {
  return { id: job.id, requestId: job.request_id, kind: job.kind, zaloAccountId: job.zalo_account_id,
    body: job.body, imageUrls: job.image_urls, status: job.status, lastError: job.last_error,
    total: job.total, sent: job.sent, unknown: job.unknown, createdAt: job.created_at, updatedAt: job.updated_at };
}
function fail(reply: FastifyReply, error: unknown) {
  if (error instanceof PostingError) return reply.code(error.statusCode).send({ error: error.message });
  return reply.code(503).send({ error: 'Chức năng gửi từ CRM chưa sẵn sàng. Vui lòng kiểm tra cấu hình/migration hoặc thử lại sau.' });
}

export async function manualPostingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireGrant('posting', 'access'));
  const enabled = process.env.CRM_MANUAL_POSTING_ENABLED === 'true';
  const store = new ManualPostingStore(), worker = new ManualPostingWorker(app, store);
  const gate = async () => {
    if (!enabled || !await store.ready()) throw new PostingError(503, 'Chưa kích hoạt gửi từ CRM hoặc chưa áp dụng migration riêng.');
  };
  const viewJob = async (viewer: PostingViewer, id: string) => {
    const job = await store.get(viewer.orgId, postingId(id));
    if (!job || job.created_by_id !== viewer.id && !['owner', 'admin'].includes(viewer.role)) throw new PostingError(404, 'Không tìm thấy lượt gửi.');
    await requirePostingAccount(viewer, job.zalo_account_id);
    return job;
  };
  app.addHook('onReady', async () => { if (enabled) worker.start(); });
  app.addHook('onClose', async () => { await worker.stop(); });

  app.get('/api/v1/manual-posting/status', async (_request, reply) => {
    try { return { enabled, ready: enabled && await store.ready(), maxRecipients: 50, maxImages: 10, minDelaySeconds: 10 }; }
    catch (error) { return fail(reply, error); }
  });
  app.get('/api/v1/manual-posting/accounts', async (request, reply) => {
    try { await gate(); return { accounts: await postingAccounts(request.user) }; }
    catch (error) { return fail(reply, error); }
  });
  app.get<{ Querystring: { accountId: string; kind: string; q?: string; offset?: string } }>('/api/v1/manual-posting/targets', async (request, reply) => {
    try {
      await gate(); const q = request.query, offset = Number(q.offset ?? 0);
      if (!Number.isInteger(offset) || offset < 0 || offset > 10000) throw new PostingError(400, 'Phân trang không hợp lệ.');
      const result = await postingTargets(app, request.user, postingId(q.accountId), postingKind(q.kind), { query: q.q, offset, req: request });
      return { targets: result.targets.map(t => ({ id: t.id, name: t.name })), nextOffset: result.nextOffset };
    } catch (error) { return fail(reply, error); }
  });
  app.post('/api/v1/manual-posting/jobs', async (request, reply) => {
    try {
      await gate(); const draft = validatePostingDraft(request.body);
      await requirePostingAccount(request.user, draft.zaloAccountId, true);
      const found = await postingTargets(app, request.user, draft.zaloAccountId, draft.kind, { ids: draft.targetIds, req: request });
      const byId = new Map(found.targets.map(t => [t.id, t]));
      const targets = draft.targetIds.map(id => { const target = byId.get(id); if (!target) throw new PostingError(404, 'Có người nhận không còn hợp lệ hoặc ngoài quyền truy cập.'); return target; });
      if (new Set(targets.map(t => t.threadId)).size !== targets.length) throw new PostingError(400, 'Có người nhận trùng định danh Zalo.');
      const result = await store.create(request.user, draft, targets);
      worker.wake(true);
      return reply.code(result.duplicate ? 200 : 202).send({ job: dto(result.job), duplicate: result.duplicate });
    } catch (error) { return fail(reply, error); }
  });
  app.get<{ Querystring: { kind: string } }>('/api/v1/manual-posting/jobs', async (request, reply) => {
    try {
      await gate(); const accounts = await postingAccounts(request.user);
      return { jobs: (await store.list(request.user.orgId, request.user.id, ['owner','admin'].includes(request.user.role), accounts.map(a => a.id), postingKind(request.query.kind))).map(dto) };
    } catch (error) { return fail(reply, error); }
  });
  app.get<{ Params: { id: string } }>('/api/v1/manual-posting/jobs/:id', async (request, reply) => {
    try {
      await gate(); const job = await viewJob(request.user, request.params.id);
      const recipients = await store.recipients(request.user.orgId, job.id);
      // Reauthorize current source access before disclosing historical names.
      for (const recipient of recipients) {
        const visible = await postingTargets(app, request.user, job.zalo_account_id, job.kind, { ids: [recipient.target_ref], req: request });
        if (!visible.targets.length) throw new PostingError(404, 'Không còn quyền xem đầy đủ người nhận của lượt gửi này.');
      }
      return { job: dto(job), recipients: recipients.map(r => ({ id: r.id, name: r.display_name, status: r.status, error: r.error, sentAt: r.sent_at })) };
    } catch (error) { return fail(reply, error); }
  });
  app.post<{ Params: { id: string } }>('/api/v1/manual-posting/jobs/:id/cancel', async (request, reply) => {
    try {
      await gate(); const job = await viewJob(request.user, request.params.id);
      return { cancelled: await store.cancel(request.user.orgId, job.id) };
    } catch (error) { return fail(reply, error); }
  });
}
