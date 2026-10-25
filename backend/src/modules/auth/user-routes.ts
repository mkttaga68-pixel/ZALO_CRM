/**
 * User management routes — CRUD for users within an org.
 * All routes require authentication via authMiddleware.
 * Role-based access: owner > admin > member.
 *
 * Security notes (phase 06 of security plan):
 *  - PUT /users/:id uses a per-role field allowlist so a member can only
 *    edit their own fullName, never email/teamId/role (which previously
 *    enabled email hijack for password-reset interception).
 *  - Email uniqueness check returns a generic response to remove the
 *    cross-org enumeration oracle. The DB still enforces global @unique;
 *    we just don't reveal whether a collision was the reason.
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from './auth-middleware.js';
import bcrypt from 'bcryptjs';
import { normalizePhone } from '../../shared/utils/phone.js';
import { buildDeletionPreview, deleteUserPermanently } from './user-delete-service.js';
import { randomUUID } from 'node:crypto';
import { logger } from '../../shared/utils/logger.js';

// Generic message used for any validation rejection on user mutation.
// Don't differentiate "email exists" vs "invalid format" — that's the oracle.
const GENERIC_VALIDATION_ERROR = 'Dữ liệu không hợp lệ';

/**
 * Catch Prisma P2002 (unique constraint violation) and rethrow as a
 * regular 400 with the generic message. Anything else propagates.
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // GET /api/v1/users — list all users in org
  app.get('/api/v1/users', async (request: FastifyRequest) => {
    const user = request.user!;
    const users = await prisma.user.findMany({
      where: { orgId: user.orgId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        isActive: true,
        teamId: true,
        createdAt: true,
        team: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return { users };
  });

  // POST /api/v1/users — create user (owner/admin only)
  app.post('/api/v1/users', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { email, fullName, password, role = 'member', teamId } = request.body as any;
    if (!email || !fullName || !password) {
      return reply.status(400).send({ error: 'Email, họ tên, mật khẩu là bắt buộc' });
    }

    if (role === 'owner') return reply.status(400).send({ error: 'Không thể tạo thêm owner' });
    if (role === 'admin' && currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có thể tạo admin' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let user;
    try {
      user = await prisma.user.create({
        data: {
          id: randomUUID(),
          orgId: currentUser.orgId,
          email,
          fullName,
          passwordHash,
          role,
          teamId: teamId || null,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Don't reveal whether the email already exists in another org.
        return reply.status(400).send({ error: GENERIC_VALIDATION_ERROR });
      }
      throw err;
    }

    logger.info(`User created: ${user.email} by ${currentUser.email}`);
    return user;
  });

  // PUT /api/v1/users/:id — update user info
  app.put('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const { id } = request.params as { id: string };

    const isSelf = currentUser.id === id;
    const isAdmin = ['owner', 'admin'].includes(currentUser.role);
    const isOwner = currentUser.role === 'owner';

    if (!isAdmin && !isSelf) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { fullName, email, phone, role, teamId, isActive } = request.body as any;

    // Field allowlist by role. Self-edit (non-admin) is restricted to fullName.
    // Admin can edit email + teamId of anyone in their org. Owner adds role + isActive.
    // Email change of self is blocked even for owners — owners go through a
    // separate flow (or change DB directly) to avoid accidental self-lockout.
    const updateData: Record<string, unknown> = {};

    if (fullName !== undefined) updateData.fullName = fullName;

    if (email !== undefined) {
      if (!isAdmin) return reply.status(403).send({ error: 'Không có quyền đổi email' });
      if (isSelf) return reply.status(400).send({ error: 'Không thể đổi email của chính mình' });
      updateData.email = email;
    }

    // SĐT đăng nhập — lưu dạng chuẩn 84xxxxxxxxx (xem normalizePhone) để khớp
    // đúng lúc đăng nhập dù nhập 0xxx / +84xxx. Chuỗi rỗng = gỡ SĐT.
    if (phone !== undefined) {
      if (!isAdmin) return reply.status(403).send({ error: 'Không có quyền đổi số điện thoại' });
      const raw = typeof phone === 'string' ? phone.trim() : '';
      if (raw === '') {
        updateData.phone = null;
      } else {
        const canonical = normalizePhone(raw);
        if (!canonical) return reply.status(400).send({ error: 'Số điện thoại không hợp lệ' });
        updateData.phone = canonical;
      }
    }

    if (teamId !== undefined) {
      if (!isAdmin) return reply.status(403).send({ error: 'Không có quyền đổi nhóm' });
      updateData.teamId = teamId || null;
    }

    if (role !== undefined) {
      if (!isOwner) return reply.status(403).send({ error: 'Chỉ owner có quyền đổi vai trò' });
      if (isSelf && role !== currentUser.role) {
        return reply.status(400).send({ error: 'Không thể thay đổi role của chính mình' });
      }
      updateData.role = role;
    }

    if (isActive !== undefined) {
      if (!isOwner) return reply.status(403).send({ error: 'Chỉ owner có quyền kích hoạt/khóa tài khoản' });
      updateData.isActive = isActive;
    }

    let user;
    try {
      user = await prisma.user.update({
        where: { id, orgId: currentUser.orgId },
        data: updateData,
        select: {
          id: true,
          email: true,
          fullName: true,
          phone: true,
          role: true,
          isActive: true,
          teamId: true,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.status(400).send({ error: GENERIC_VALIDATION_ERROR });
      }
      throw err;
    }

    return user;
  });

  // PUT /api/v1/users/:id/password — reset password (owner/admin only)
  app.put('/api/v1/users/:id/password', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (!['owner', 'admin'].includes(currentUser.role)) {
      return reply.status(403).send({ error: 'Không có quyền' });
    }

    const { id } = request.params as { id: string };
    const { password } = request.body as { password: string };
    if (!password || password.length < 6) {
      return reply.status(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id, orgId: currentUser.orgId },
      data: { passwordHash },
    });

    return { success: true };
  });

  // GET /api/v1/users/:id/deletion-preview — xoá vĩnh viễn sẽ cần bàn giao gì?
  // Chỉ đọc. Owner only, cùng cấp quyền với lệnh xoá thật.
  app.get('/api/v1/users/:id/deletion-preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ chủ tổ chức có quyền xoá nhân viên' });
    }
    const { id } = request.params as { id: string };
    const preview = await buildDeletionPreview(currentUser.orgId, id);
    if (!preview) return reply.status(404).send({ error: 'Nhân viên không tồn tại trong tổ chức' });
    return { preview };
  });

  // DELETE /api/v1/users/:id — mặc định VÔ HIỆU HOÁ (giữ nguyên hành vi cũ).
  // ?mode=hard  → XOÁ VĨNH VIỄN, kèm &transferToUserId=... để bàn giao nick Zalo,
  //               ghi chú, kịch bản sang người khác (xem user-delete-service.ts).
  // Owner only ở cả 2 chế độ.
  app.delete('/api/v1/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner') {
      return reply.status(403).send({ error: 'Chỉ owner có quyền xóa nhân viên' });
    }

    const { id } = request.params as { id: string };
    const { mode, transferToUserId } = request.query as { mode?: string; transferToUserId?: string };

    if (id === currentUser.id) {
      return reply.status(400).send({ error: 'Không thể xóa chính mình' });
    }

    if (mode !== 'hard') {
      await prisma.user.update({
        where: { id, orgId: currentUser.orgId },
        data: { isActive: false },
      });
      return { success: true, mode: 'deactivate' };
    }

    const res = await deleteUserPermanently({
      orgId: currentUser.orgId,
      userId: id,
      transferToUserId: transferToUserId || null,
      actor: { id: currentUser.id, email: currentUser.email },
    });

    if (!res.ok) {
      const messages: Record<string, { code: number; msg: string }> = {
        not_found: { code: 404, msg: 'Nhân viên không tồn tại trong tổ chức' },
        self: { code: 400, msg: 'Không thể xoá chính mình' },
        last_owner: { code: 400, msg: 'Không thể xoá chủ tổ chức cuối cùng' },
        transfer_required: {
          code: 400,
          msg: 'Nhân viên này còn nick Zalo / ghi chú / kịch bản — phải chọn người nhận bàn giao trước khi xoá',
        },
        bad_transfer_target: { code: 400, msg: 'Người nhận bàn giao không hợp lệ' },
      };
      const m = messages[res.error] ?? { code: 400, msg: 'Không xoá được nhân viên' };
      return reply.status(m.code).send({ error: m.msg, code: res.error });
    }

    return { success: true, mode: 'hard', ...res.result };
  });

  // Phase Privacy v2 2026-05-23 — admin sửa maxPrivacyNicks per user.
  // PATCH /api/v1/users/:id/max-privacy-nicks { maxPrivacyNicks: 1-10 }
  // Permission: org admin/owner only.
  app.patch('/api/v1/users/:id/max-privacy-nicks', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    if (currentUser.role !== 'owner' && currentUser.role !== 'admin') {
      return reply.status(403).send({ error: 'Chỉ admin/owner sửa được maxPrivacyNicks' });
    }
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { maxPrivacyNicks?: number };
    const max = body.maxPrivacyNicks;
    if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 10) {
      return reply.status(400).send({ error: 'maxPrivacyNicks phải là số nguyên 1-10' });
    }

    const target = await prisma.user.findFirst({
      where: { id, orgId: currentUser.orgId },
      select: { id: true },
    });
    if (!target) return reply.status(404).send({ error: 'User không tồn tại trong org' });

    await prisma.user.update({
      where: { id },
      data: { maxPrivacyNicks: max },
    });

    return { ok: true, userId: id, maxPrivacyNicks: max };
  });

  // Phase Privacy v2 2026-05-23 — user pick nick "liên lạc nội bộ" của mình.
  // PATCH /api/v1/me/internal-contact { zaloAccountId: string | null }
  // Constraint: nick phải user OWN (ownerUserId === current user).
  app.patch('/api/v1/me/internal-contact', async (request: FastifyRequest, reply: FastifyReply) => {
    const currentUser = request.user!;
    const body = (request.body ?? {}) as { zaloAccountId?: string | null };
    const accountId = body.zaloAccountId ?? null;

    if (accountId !== null) {
      // Verify nick exists in org AND user owns it
      const nick = await prisma.zaloAccount.findFirst({
        where: { id: accountId, orgId: currentUser.orgId },
        select: { id: true, ownerUserId: true },
      });
      if (!nick) return reply.status(404).send({ error: 'Nick không tồn tại trong org' });
      if (nick.ownerUserId !== currentUser.id) {
        return reply.status(403).send({ error: 'Chỉ chọn được nick mình OWN làm liên lạc nội bộ' });
      }
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: { internalContactZaloAccountId: accountId },
    });

    return { ok: true, internalContactZaloAccountId: accountId };
  });

  // Phase Privacy v2 2026-05-23 — GET /me/internal-contact (load current value).
  // Auto-default: nếu user chưa có internalContactZaloAccountId + có ≥1 nick own
  //   → pick nick có nhiều friend nhất, persist, return.
  // Sale có thể override thủ công sau qua PATCH /me/internal-contact.
  app.get('/api/v1/me/internal-contact', async (request: FastifyRequest) => {
    const currentUser = request.user!;
    let me = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: {
        internalContactZaloAccountId: true,
        maxPrivacyNicks: true,
        internalContactNick: {
          select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true },
        },
      },
    });

    if (!me) {
      return { internalContactZaloAccountId: null, internalContactNick: null, maxPrivacyNicks: 2, autoDefaulted: false };
    }

    let autoDefaulted = false;
    if (!me.internalContactZaloAccountId) {
      // Auto-pick: nick own có nhiều friend nhất.
      const candidates = await prisma.zaloAccount.findMany({
        where: { ownerUserId: currentUser.id, orgId: currentUser.orgId },
        select: { id: true, _count: { select: { friends: true } } },
      });
      if (candidates.length > 0) {
        const best = candidates.reduce((acc, c) =>
          (c._count?.friends ?? 0) > (acc._count?.friends ?? 0) ? c : acc,
        );
        await prisma.user.update({
          where: { id: currentUser.id },
          data: { internalContactZaloAccountId: best.id },
        });
        // Reload
        me = await prisma.user.findUnique({
          where: { id: currentUser.id },
          select: {
            internalContactZaloAccountId: true,
            maxPrivacyNicks: true,
            internalContactNick: {
              select: { id: true, displayName: true, avatarUrl: true, zaloUid: true, status: true },
            },
          },
        });
        autoDefaulted = true;
      }
    }

    return {
      internalContactZaloAccountId: me?.internalContactZaloAccountId ?? null,
      internalContactNick: me?.internalContactNick ?? null,
      maxPrivacyNicks: me?.maxPrivacyNicks ?? 2,
      autoDefaulted,
    };
  });
}
