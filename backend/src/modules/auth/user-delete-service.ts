/**
 * user-delete-service.ts — Xoá VĨNH VIỄN một nhân viên khỏi hệ thống, có bàn giao.
 *
 * VÌ SAO CẦN BÀN GIAO (không thể xoá thẳng):
 * Nhiều bảng trỏ tới User bằng khoá ngoại BẮT BUỘC và KHÔNG có onDelete, nên
 * Postgres mặc định RESTRICT — lệnh xoá sẽ fail giữa chừng nếu nhân viên còn:
 *   - ZaloAccount.ownerUserId   (nick Zalo họ sở hữu — kèm toàn bộ KH đang chăm)
 *   - Note.authorUserId         (ghi chú họ viết)
 *   - Block.createdById, BlockFolder.createdById
 *   - AutomationSequence / AutomationTrigger / AutomationBroadcast .createdById
 * Vì vậy trước khi xoá phải CHUYỂN các bản ghi này sang một nhân viên khác.
 *
 * Các quan hệ còn lại tự xử lý, không cần đụng tới:
 *   - onDelete: Cascade  → ZaloAccountAccess, ContactAccess, DepartmentMember,
 *     UserPreference, SavedFilterPreset, AccountFolder, UserPrivacySession,
 *     SystemNotifyRecipient, PhoneSearchEvent… (xoá theo user)
 *   - Cột nullable không khai báo onDelete → Prisma/Postgres SET NULL:
 *     Contact.assignedUserId, Appointment.userId, Message.repliedByUserId,
 *     ActivityLog.userId… (giữ bản ghi, chỉ bỏ liên kết người)
 *
 * KHÔNG xoá KH, hội thoại hay tin nhắn: dữ liệu khách hàng thuộc về tổ chức,
 * không thuộc về cá nhân. Nick Zalo cũng chỉ ĐỔI CHỦ, không bị gỡ kết nối.
 */
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { logActivity } from '../activity/activity-logger.js';

export interface DeletionBlockers {
  zaloAccounts: number;
  notes: number;
  blocks: number;
  blockFolders: number;
  sequences: number;
  triggers: number;
  broadcasts: number;
}

export interface DeletionPreview {
  user: { id: string; fullName: string; email: string; role: string; isActive: boolean };
  /** Bản ghi BẮT BUỘC phải bàn giao trước khi xoá được */
  blockers: DeletionBlockers;
  /** Tổng số bản ghi cần bàn giao — 0 thì xoá thẳng được */
  blockerTotal: number;
  /** Dữ liệu chỉ bị gỡ liên kết người phụ trách, KHÔNG mất */
  unlinked: { assignedContacts: number; appointments: number };
  /** Ứng viên nhận bàn giao (nhân viên còn hoạt động khác trong org) */
  transferCandidates: Array<{ id: string; fullName: string; email: string; role: string }>;
}

async function countBlockers(orgId: string, userId: string): Promise<DeletionBlockers> {
  const [zaloAccounts, notes, blocks, blockFolders, sequences, triggers, broadcasts] = await Promise.all([
    prisma.zaloAccount.count({ where: { orgId, ownerUserId: userId } }),
    prisma.note.count({ where: { orgId, authorUserId: userId } }),
    prisma.block.count({ where: { orgId, createdById: userId } }),
    prisma.blockFolder.count({ where: { orgId, createdById: userId } }),
    prisma.automationSequence.count({ where: { orgId, createdById: userId } }),
    prisma.automationTrigger.count({ where: { orgId, createdById: userId } }),
    prisma.automationBroadcast.count({ where: { orgId, createdById: userId } }),
  ]);
  return { zaloAccounts, notes, blocks, blockFolders, sequences, triggers, broadcasts };
}

function sumBlockers(b: DeletionBlockers): number {
  return b.zaloAccounts + b.notes + b.blocks + b.blockFolders + b.sequences + b.triggers + b.broadcasts;
}

/** Xem trước: cần bàn giao những gì, và ai nhận được. Chỉ đọc, không ghi. */
export async function buildDeletionPreview(
  orgId: string,
  userId: string,
): Promise<DeletionPreview | null> {
  const user = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: { id: true, fullName: true, email: true, role: true, isActive: true },
  });
  if (!user) return null;

  const [blockers, assignedContacts, appointments, candidates] = await Promise.all([
    countBlockers(orgId, userId),
    prisma.contact.count({ where: { orgId, assignedUserId: userId } }),
    prisma.appointment.count({ where: { orgId, assignedUserId: userId } }),
    prisma.user.findMany({
      where: { orgId, id: { not: userId }, isActive: true },
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { fullName: 'asc' },
    }),
  ]);

  return {
    user,
    blockers,
    blockerTotal: sumBlockers(blockers),
    unlinked: { assignedContacts, appointments },
    transferCandidates: candidates,
  };
}

export interface DeleteUserResult {
  deletedUserId: string;
  transferredTo: { id: string; fullName: string; email: string } | null;
  transferred: DeletionBlockers;
}

export type DeleteUserError =
  | 'not_found'
  | 'self'
  | 'last_owner'
  | 'transfer_required'
  | 'bad_transfer_target';

/**
 * Xoá vĩnh viễn + bàn giao, tất cả trong MỘT transaction: hoặc bàn giao xong rồi
 * xoá trọn vẹn, hoặc không đổi gì. Tránh trạng thái nửa vời (đã chuyển nick nhưng
 * xoá user thất bại).
 */
export async function deleteUserPermanently(args: {
  orgId: string;
  userId: string;
  transferToUserId?: string | null;
  actor: { id: string; email?: string };
}): Promise<{ ok: true; result: DeleteUserResult } | { ok: false; error: DeleteUserError; detail?: string }> {
  const { orgId, userId, actor } = args;

  if (userId === actor.id) return { ok: false, error: 'self' };

  const target = await prisma.user.findFirst({
    where: { id: userId, orgId },
    select: { id: true, fullName: true, email: true, role: true },
  });
  if (!target) return { ok: false, error: 'not_found' };

  // Không để org mất chủ sở hữu cuối cùng → khoá cứng toàn tổ chức.
  if (target.role === 'owner') {
    const owners = await prisma.user.count({ where: { orgId, role: 'owner' } });
    if (owners <= 1) return { ok: false, error: 'last_owner' };
  }

  const blockers = await countBlockers(orgId, userId);
  const needTransfer = sumBlockers(blockers) > 0;

  let transferTo: { id: string; fullName: string; email: string } | null = null;
  if (needTransfer) {
    if (!args.transferToUserId) return { ok: false, error: 'transfer_required' };
    if (args.transferToUserId === userId) return { ok: false, error: 'bad_transfer_target' };
    // Người nhận phải cùng org và còn hoạt động — fail-closed.
    transferTo = await prisma.user.findFirst({
      where: { id: args.transferToUserId, orgId, isActive: true },
      select: { id: true, fullName: true, email: true },
    });
    if (!transferTo) return { ok: false, error: 'bad_transfer_target' };
  }

  const newOwnerId = transferTo?.id;

  await prisma.$transaction(async (tx) => {
    if (newOwnerId) {
      // Nick Zalo đổi chủ — KHÔNG gỡ kết nối, KH đang chăm giữ nguyên.
      await tx.zaloAccount.updateMany({ where: { orgId, ownerUserId: userId }, data: { ownerUserId: newOwnerId } });
      await tx.note.updateMany({ where: { orgId, authorUserId: userId }, data: { authorUserId: newOwnerId } });
      await tx.block.updateMany({ where: { orgId, createdById: userId }, data: { createdById: newOwnerId } });
      await tx.blockFolder.updateMany({ where: { orgId, createdById: userId }, data: { createdById: newOwnerId } });
      await tx.automationSequence.updateMany({ where: { orgId, createdById: userId }, data: { createdById: newOwnerId } });
      await tx.automationTrigger.updateMany({ where: { orgId, createdById: userId }, data: { createdById: newOwnerId } });
      await tx.automationBroadcast.updateMany({ where: { orgId, createdById: userId }, data: { createdById: newOwnerId } });
    }

    // internalContactZaloAccountId của NGƯỜI KHÁC có thể trỏ tới nick vừa đổi chủ —
    // quan hệ đó đã là SetNull nên không cần đụng. Riêng BlockFolder.ownerUserId là
    // SetNull, tự xử lý khi xoá user.
    await tx.user.delete({ where: { id: userId } });
  });

  logger.info(
    `[user-delete] Đã xoá vĩnh viễn ${target.email} (${target.role}) bởi ${actor.email ?? actor.id}` +
      (transferTo ? ` — bàn giao sang ${transferTo.email}` : ' — không có gì phải bàn giao'),
  );

  logActivity({
    orgId,
    userId: actor.id,
    action: 'user_deleted_permanently',
    category: 'system',
    entityType: 'user',
    entityId: userId,
    details: {
      deletedUser: { id: target.id, email: target.email, fullName: target.fullName, role: target.role },
      transferredTo: transferTo,
      transferred: blockers,
      actorEmail: actor.email,
    },
  });

  return {
    ok: true,
    result: { deletedUserId: userId, transferredTo: transferTo, transferred: blockers },
  };
}
