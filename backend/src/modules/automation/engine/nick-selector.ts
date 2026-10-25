// Phase 7 Engine — nick pool selector.
//
// When AutomationTask has no pre-assigned nick, the worker calls pickNickForTask
// to choose one from the org's connected ZaloAccounts based on actionType:
//
//   send_message    → MUST pick a nick that's already a friend with this contact
//                     (Friend.friendshipStatus='accepted'). Falls back to any nick
//                     in 'pending_sent' if no accepted exists (Zalo allows sending
//                     to pending pairs in many cases).
//
//   request_friend  → Pick any connected nick under daily cap. Avoid nicks that
//                     already sent a friend req to this contact (FriendshipAttempt
//                     dedup). Round-robin by lastFriendReqSentAt to spread load.
//
//   update_status   → No nick needed (DB-only action). Worker skips this selector.

import { prisma } from '../../../shared/database/prisma-client.js';
import type { BlockActionType } from '../blocks/types.js';

export interface NickSelection {
  nickId: string;
  reason: 'existing_friend' | 'round_robin' | 'cap_aware' | 'fixed';
}

/**
 * Chính sách chọn nick (2026-10-25).
 *
 * `mode: 'auto'` là hành vi cũ, mặc định khi trigger không cấu hình gì —
 * engine tự chọn nick trong pool.
 *
 * `mode: 'fixed'` dùng cho các kịch bản mà việc gửi từ ĐÚNG nick nào là phần
 * của nghiệp vụ (vd CSKH phải do nick CSKH gửi). Nick chỉ định không khả dụng
 * thì BỎ QUA task, KHÔNG tự chuyển sang nick khác: đổi nick giữa dòng làm KH
 * nhận tin từ người lạ và phá luồng hội thoại đang có.
 *
 * `onBehalfOfUserId`: nếu set, nick phải nằm trong quyền (ZaloAccountAccess
 * permission 'chat' | 'admin') của user đó. Dùng để automation không gửi được
 * từ nick mà người cấu hình trigger không có quyền dùng.
 */
export interface NickPolicy {
  mode?: 'auto' | 'fixed';
  fixedNickId?: string | null;
  onBehalfOfUserId?: string | null;
}

/** Lý do không chọn được nick — ghi vào AutomationTask.skipReason để truy vết. */
export type NickSkipReason =
  | 'fixed_nick_not_found'
  | 'fixed_nick_not_connected'
  | 'fixed_nick_no_permission'
  | 'fixed_nick_not_friend';

/**
 * Nick có nằm trong quyền của user không. `null` userId = không yêu cầu quyền
 * (hành vi cũ). Chỉ 'chat' và 'admin' được gửi tin; 'read' là chỉ xem.
 */
async function userMayUseNick(userId: string, nickId: string): Promise<boolean> {
  const access = await prisma.zaloAccountAccess.findUnique({
    where: { zaloAccountId_userId: { zaloAccountId: nickId, userId } },
    select: { permission: true },
  });
  return access?.permission === 'chat' || access?.permission === 'admin';
}

export async function pickNickForTask(args: {
  orgId: string;
  contactId: string;
  actionType: BlockActionType;
  nickPolicy?: NickPolicy | null;
}): Promise<NickSelection | { nickId: null; skipReason: NickSkipReason } | null> {
  const { orgId, contactId, actionType, nickPolicy } = args;

  // ── Chính sách nick cố định: dùng đúng nick đó hoặc bỏ qua ──────────────
  if (nickPolicy?.mode === 'fixed') {
    const fixedId = nickPolicy.fixedNickId;
    if (!fixedId) return { nickId: null, skipReason: 'fixed_nick_not_found' };

    const nick = await prisma.zaloAccount.findFirst({
      where: { id: fixedId, orgId },
      select: { id: true, status: true },
    });
    if (!nick) return { nickId: null, skipReason: 'fixed_nick_not_found' };
    // Nick offline → bỏ qua, KHÔNG đổi nick. Task có thể retry lần sau khi nick
    // online lại (worker gọi lại selector ở mỗi attempt).
    if (nick.status !== 'connected') return { nickId: null, skipReason: 'fixed_nick_not_connected' };

    if (nickPolicy.onBehalfOfUserId
        && !(await userMayUseNick(nickPolicy.onBehalfOfUserId, nick.id))) {
      return { nickId: null, skipReason: 'fixed_nick_no_permission' };
    }

    // Gửi tin thì phải có quan hệ hợp lệ giữa ĐÚNG nick này và KH.
    if (actionType === 'send_message') {
      const friend = await prisma.friend.findFirst({
        where: {
          orgId, contactId, zaloAccountId: nick.id,
          OR: [
            { friendshipStatus: 'accepted' },
            { friendshipStatus: 'pending_sent', hasConversation: true },
          ],
        },
        select: { id: true },
      });
      if (!friend) return { nickId: null, skipReason: 'fixed_nick_not_friend' };
    }

    return { nickId: nick.id, reason: 'fixed' };
  }

  // ── send_message: prefer accepted friend; fallback to pending_sent ONLY if conversation exists ─
  // FIX A5: previously returned pending_sent/pending_received nicks blindly,
  // which Zalo policy may reject. Now strict: accepted only, or pending_sent
  // WITH hasConversation=true (KH replied first, Zalo allows continued chat).
  if (actionType === 'send_message') {
    const friends = await prisma.friend.findMany({
      where: {
        orgId,
        contactId,
        OR: [
          { friendshipStatus: 'accepted' },
          { friendshipStatus: 'pending_sent', hasConversation: true },
        ],
        zaloAccount: { status: 'connected' },
      },
      select: { zaloAccountId: true, friendshipStatus: true, lastInboundAt: true },
      orderBy: [{ lastInboundAt: 'desc' }],
    });
    if (friends.length === 0) return null;

    // Lọc theo quyền dùng nick nếu trigger yêu cầu (2026-10-25). Không set
    // onBehalfOfUserId → giữ nguyên hành vi cũ, không lọc gì.
    let candidates = friends;
    if (nickPolicy?.onBehalfOfUserId) {
      const uid = nickPolicy.onBehalfOfUserId;
      const allowed: typeof friends = [];
      for (const f of friends) {
        if (await userMayUseNick(uid, f.zaloAccountId)) allowed.push(f);
      }
      candidates = allowed;
      if (candidates.length === 0) return null;
    }

    const accepted = candidates.find((f) => f.friendshipStatus === 'accepted');
    if (accepted) return { nickId: accepted.zaloAccountId, reason: 'existing_friend' };
    return { nickId: candidates[0].zaloAccountId, reason: 'existing_friend' };
  }

  // ── request_friend: pick any connected nick not already attempted ──────
  if (actionType === 'request_friend') {
    // Find nicks that have NOT already attempted this contact
    const priorAttempts = await prisma.friendshipAttempt.findMany({
      where: { orgId, contactId },
      select: { zaloAccountId: true },
    });
    const excludedNickIds = new Set(priorAttempts.map((a) => a.zaloAccountId));

    // Get connected nicks ordered by last activity (round-robin: oldest first
    // so load spreads across nicks instead of hammering one)
    const nicks = await prisma.zaloAccount.findMany({
      where: {
        orgId,
        status: 'connected',
        id: { notIn: Array.from(excludedNickIds) },
      },
      select: {
        id: true,
        lastFriendReqSentAt: true,
        dailyFriendAddCap: true,
      },
      orderBy: [{ lastFriendReqSentAt: 'asc' }],
    });
    if (nicks.length === 0) return null;

    // Filter out nicks that hit their daily cap
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    for (const nick of nicks) {
      // Quyền dùng nick (2026-10-25) — chỉ lọc khi trigger yêu cầu.
      if (nickPolicy?.onBehalfOfUserId
          && !(await userMayUseNick(nickPolicy.onBehalfOfUserId, nick.id))) {
        continue;
      }
      if (nick.dailyFriendAddCap <= 0) {
        return { nickId: nick.id, reason: 'cap_aware' };
      }
      const todayCount = await prisma.automationTask.count({
        where: {
          assignedNickId: nick.id,
          state: 'done',
          executedAt: { gte: startOfDay },
          block: { actionType: 'request_friend' },
        },
      });
      if (todayCount < nick.dailyFriendAddCap) {
        return { nickId: nick.id, reason: 'round_robin' };
      }
    }
    return null; // all nicks capped out
  }

  // ── update_status + other: no nick needed ───────────────────────────────
  return null;
}
