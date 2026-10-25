/**
 * admin-purge-routes.ts — API cho admin xoá dữ liệu trang Khách hàng mà 1 user
 * vừa đồng bộ vào. Xem admin-purge-service.ts cho ngữ nghĩa + nguyên tắc an toàn.
 *
 * Endpoints (tất cả owner/admin only):
 *   GET  /api/v1/admin/contact-purge/targets   — nhân viên + nick + số KH đã đồng bộ
 *   POST /api/v1/admin/contact-purge/preview   — tính trước, KHÔNG ghi gì
 *   POST /api/v1/admin/contact-purge/execute   — xoá thật, cần xác nhận
 *   POST /api/v1/admin/contact-purge/resume    — bật lại đồng bộ cho nick
 *
 * Hai lớp chắn trên /execute:
 *   1. Chỉ owner/admin trong CÙNG org (service luôn filter orgId + ownerUserId).
 *   2. Body phải có `confirm` gõ khớp email của nhân viên bị xoá dữ liệu —
 *      chặn bấm nhầm và chặn client cũ gọi lại endpoint không chủ đích.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireRole } from '../auth/role-middleware.js';
import {
  listPurgeTargets,
  buildPurgePlan,
  executePurge,
  resumeSync,
} from './admin-purge-service.js';

interface ScopeBody {
  userId?: string;
  zaloAccountIds?: string[];
  keepCurated?: boolean;
  deleteConversations?: boolean;
  confirm?: string;
}

function readScope(body: ScopeBody | undefined) {
  const b = body ?? {};
  return {
    userId: typeof b.userId === 'string' ? b.userId.trim() : '',
    zaloAccountIds: Array.isArray(b.zaloAccountIds) ? b.zaloAccountIds.filter((v) => typeof v === 'string') : undefined,
    // Mặc định GIỮ KH đã chăm thật — chọn mặc định an toàn hơn, FE phải chủ động tắt.
    keepCurated: b.keepCurated !== false,
    deleteConversations: b.deleteConversations === true,
  };
}

export async function adminPurgeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireRole('owner', 'admin'));

  // ── Danh sách nhân viên có nick Zalo + số KH đã đồng bộ qua từng nick ─────
  app.get('/api/v1/admin/contact-purge/targets', async (request: FastifyRequest) => {
    const user = request.user!;
    const targets = await listPurgeTargets(user.orgId);
    return { targets };
  });

  // ── Xem trước (chỉ đọc) ───────────────────────────────────────────────────
  app.post('/api/v1/admin/contact-purge/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const scope = readScope(request.body as ScopeBody);
    if (!scope.userId) {
      return reply.status(400).send({ error: 'Thiếu userId — chọn nhân viên cần xoá dữ liệu' });
    }

    const plan = await buildPurgePlan({ orgId: user.orgId, ...scope });
    if (!plan) {
      return reply.status(404).send({ error: 'Nhân viên không tồn tại trong tổ chức' });
    }
    return { plan };
  });

  // ── Xoá thật ──────────────────────────────────────────────────────────────
  app.post('/api/v1/admin/contact-purge/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = request.user!;
    const body = (request.body ?? {}) as ScopeBody;
    const scope = readScope(body);
    if (!scope.userId) {
      return reply.status(400).send({ error: 'Thiếu userId — chọn nhân viên cần xoá dữ liệu' });
    }

    // Tính plan để lấy chuỗi đối chiếu confirm. Service tự tính lại plan lần nữa
    // khi xoá, nên con số thật luôn là con số tại thời điểm xoá.
    const plan = await buildPurgePlan({ orgId: actor.orgId, ...scope });
    if (!plan) {
      return reply.status(404).send({ error: 'Nhân viên không tồn tại trong tổ chức' });
    }

    const confirm = typeof body.confirm === 'string' ? body.confirm.trim().toLowerCase() : '';
    if (confirm !== plan.confirmPhrase.toLowerCase()) {
      return reply.status(400).send({
        error: `Để xác nhận, gõ đúng email của nhân viên: ${plan.confirmPhrase}`,
      });
    }

    if (plan.accounts.length === 0) {
      return reply.status(400).send({ error: 'Nhân viên này không có nick Zalo nào trong phạm vi đã chọn' });
    }

    const result = await executePurge({
      orgId: actor.orgId,
      ...scope,
      actorUserId: actor.id,
      actorEmail: actor.email,
    });
    if (!result) {
      return reply.status(404).send({ error: 'Nhân viên không tồn tại trong tổ chức' });
    }

    return {
      ok: true,
      result,
      // Nhắc lại cho FE hiển thị: nick đã bị tạm dừng đồng bộ, nếu không thì
      // cron 15 phút sẽ hút toàn bộ KH về lại.
      syncPausedAccountIds: result.accountsPaused,
    };
  });

  // ── Bật lại đồng bộ ───────────────────────────────────────────────────────
  app.post('/api/v1/admin/contact-purge/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = request.user!;
    const body = (request.body ?? {}) as { zaloAccountIds?: string[] };
    const ids = Array.isArray(body.zaloAccountIds) ? body.zaloAccountIds.filter((v) => typeof v === 'string') : [];
    if (ids.length === 0) {
      return reply.status(400).send({ error: 'Thiếu zaloAccountIds' });
    }

    const resumed = await resumeSync(actor.orgId, ids, { userId: actor.id, email: actor.email });
    return { ok: true, resumed };
  });
}
