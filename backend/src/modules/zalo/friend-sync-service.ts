/**
 * friend-sync-service.ts — Canonical Friend full-sync (Zalo SDK → CRM Friend table).
 *
 * Single entry point cho mọi trigger:
 *  - Manual: POST /friends-db/sync (user click "↻ Làm mới ngay")
 *  - On-connect: zalo-pool.autoSyncOnConnect (lần đầu nick lên)
 *  - Cron:    friend-sync-cron.ts every 15 min cho mọi connected account
 *
 * Pull list:
 *  - api.getAllFriends() → accepted friends
 *  - api.getSentFriendRequests() → pending_sent invitations
 *
 * Loại trùng trong lô (1 map, accepted thắng pending_sent):
 *  - Cùng 1 UID có thể nằm ở CẢ getAllFriends VÀ getSentFriendRequests. Trước đây
 *    2 vòng lặp riêng chạy tuần tự nên vòng pending GHI ĐÈ accepted → KH đã là bạn
 *    bị hạ về "đang chờ". Gom 1 map trước khi ghi DB để hết hẳn.
 *  - liveCount = số bạn bè DUY NHẤT (không cộng trùng 2 danh sách như trước).
 *
 * Chỉ đồng bộ phần CHƯA CÓ / CÓ ĐỔI (ràng buộc chính của sync):
 *  Sau khi pre-load Friend row (1 query, kèm friendshipStatus), mỗi UID rơi vào
 *  đúng 1 trong 3 nhánh:
 *   1. MỚI       — chưa có Friend row cho nick này → xử lý đầy đủ:
 *                  resolve/tạo Contact + applyFriendTransition + ghi danh tính.
 *   2. KHÔNG ĐỔI — đã có row, friendshipStatus khớp VÀ danh tính không drift
 *                  → GIỮ NGUYÊN: 0 query, 0 ghi, 0 emit.
 *   3. CÓ ĐỔI    — đã có row nhưng lệch trạng thái và/hoặc danh tính → chỉ ghi
 *                  phần lệch, dùng contactId có sẵn trong row (không resolve Contact lại),
 *                  và chỉ chạy applyFriendTransition khi trạng thái thật sự đổi.
 *
 *  Nhờ vậy nick đồng bộ lần 2+ mà danh sách bạn không đổi thì tốn đúng 2 lời gọi
 *  Zalo + 1 query DB, thay vì ~5 query + 1 transaction MỖI người bạn như trước
 *  (3000 bạn ≈ 15.000 query mỗi 15 phút → 1 query).
 *
 *  LƯU Ý: so sánh theo TẬP UID, không theo số lượng. Số lượng giữ nguyên vẫn có thể
 *  là 1 người huỷ kết bạn + 1 người mới (tổng không đổi) — so theo số lượng sẽ bỏ sót
 *  người mới đó. So theo UID thì người mới luôn được thêm.
 *
 *  Sync KHÔNG xoá Friend row của người đã huỷ kết bạn bên Zalo (giữ nguyên lịch sử
 *  chăm KH); việc đó do friend_event REMOVE xử lý.
 *
 * Cooldown 5s/account khi trigger='manual' (chống user spam click). Cron + on-connect
 * KHÔNG bị cooldown chặn.
 *
 * Errors logged via logActivity({systemSource:'friend_sync_error'}) để observable
 * qua activity dashboard, KHÔNG throw lên caller (best-effort sync).
 */
import type { Server } from 'socket.io';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { zaloOps } from '../../shared/zalo-operations.js';
import { logActivity } from '../activity/activity-logger.js';
import { applyFriendTransition } from './friend-event-handler.js';
import { buildFriendUpdatedPayload } from '../../shared/friend-serializer.js';

/**
 * Retry wrapper cho lệnh Zalo SDK nặng. Zalo hay timeout CHẬP CHỜN (~20%) khi gọi
 * từ server xa Việt Nam (latency cao). Thử lại vài lần với backoff ngắn → nâng tỉ lệ
 * thành công lên ~99% mà không cần proxy. Lỗi mạng (fetch failed/ETIMEDOUT) mới retry.
 */
async function withZaloRetry<T>(label: string, fn: () => Promise<T>, attempts = 3, delayMs = 1500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        logger.warn(`[friend-sync] ${label} lỗi (lần ${i + 1}/${attempts}), thử lại sau ${delayMs}ms`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

export type SyncTrigger = 'manual' | 'connect' | 'cron';

export interface SyncFriendsOptions {
  trigger: SyncTrigger;
  /** Socket.IO server cho emit 'friend:updated'. Optional — null thì chỉ update DB không emit. */
  io?: Server | null;
}

export interface SyncFriendsResult {
  /** Số bạn bè DUY NHẤT Zalo trả về (accepted + pending, đã loại trùng UID trong lô) */
  liveCount: number;
  /** Contact stub mới tạo do KH chưa có trong DB */
  createdContacts: number;
  /** Friend rows thực sự được ghi (= newFriends + updatedFriends) */
  upsertedFriends: number;
  /**
   * KH CHƯA CÓ trong hệ thống (không có Friend row cho nick này) → xử lý đầy đủ:
   * resolve/tạo Contact + applyFriendTransition + ghi danh tính.
   */
  newFriends: number;
  /**
   * Friend row ĐÃ CÓ và không có gì đổi (trạng thái kết bạn giữ nguyên, danh tính
   * giữ nguyên) → bỏ qua hoàn toàn, KHÔNG query, KHÔNG ghi, KHÔNG emit.
   * Lần sync thứ 2+ của 1 nick ổn định thì gần như toàn bộ nằm ở đây.
   */
  skippedUnchanged: number;
  /** Friend row đã có nhưng đổi trạng thái và/hoặc danh tính → chỉ ghi phần đổi */
  updatedFriends: number;
  /** Số 'friend:updated' socket events đã emit (= số rows thực sự đổi field) */
  emittedCount: number;
  /** Số errors gặp phải khi process per-friend (chỉ log, không throw) */
  errors: number;
  durationMs: number;
  /** True khi bị cooldown 5s (chỉ áp cho trigger='manual'). Caller có thể trả 429 cho user. */
  skipped: 'cooldown' | null;
}

// ── Cooldown registry (in-process) ─────────────────────────────────────────
// 5s/account cho manual trigger. Cron + connect bỏ qua check này.
const COOLDOWN_MS = 5_000;
const lastManualSyncAt = new Map<string, number>();

// ── Diff helper ─────────────────────────────────────────────────────────────
// Fields có thể đổi từ Zalo Real → cần diff trước khi update + emit.
// Friendship state (friendshipStatus, relationshipKind) đi qua applyFriendTransition
// riêng (có state machine + counter delta), KHÔNG include trong diff snapshot này.
const DIFFABLE_FIELDS = [
  'zaloDisplayName',
  'zaloAvatarUrl',
  'zaloGlobalId',
  'zaloUsername',
] as const;
type DiffableField = (typeof DIFFABLE_FIELDS)[number];
type DiffSnapshot = Partial<Record<DiffableField, string | null>>;

/**
 * Gộp 2 snapshot của CÙNG 1 UID xuất hiện nhiều lần trong 1 lô.
 * Giá trị mới chỉ thắng khi thật sự có (non-null) — bản ghi thiếu field không
 * được phép xoá field mà bản ghi khác đã có.
 */
function mergeSnapshot(base: DiffSnapshot, incoming: DiffSnapshot): DiffSnapshot {
  const out: DiffSnapshot = { ...base };
  for (const k of DIFFABLE_FIELDS) {
    const v = incoming[k];
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}

function computeDiff(existing: DiffSnapshot, incoming: DiffSnapshot): DiffSnapshot {
  const patch: DiffSnapshot = {};
  for (const k of DIFFABLE_FIELDS) {
    const oldV = existing[k] ?? null;
    const newV = incoming[k] ?? null;
    if (oldV !== newV) {
      patch[k] = newV;
    }
  }
  return patch;
}

// ── Parse Zalo SDK response into snapshot ──────────────────────────────────
// zca-js getAllFriends() trả objects với key variant tuỳ phiên bản:
//   userId / uid       — primary identifier (phía nick này nhìn)
//   zaloName / displayName  — tên hiển thị
//   avatar             — URL avatar
//   globalId           — global identity (cross-nick)
//   username           — handle @abc
function extractFriendInfo(raw: Record<string, unknown>): {
  uid: string;
  snapshot: DiffSnapshot;
} | null {
  const uid = String((raw.userId ?? raw.uid ?? '') as string);
  if (!uid) return null;
  return {
    uid,
    snapshot: {
      zaloDisplayName: String((raw.zaloName ?? raw.displayName ?? '') as string) || null,
      zaloAvatarUrl: String((raw.avatar ?? '') as string) || null,
      zaloGlobalId: String((raw.globalId ?? '') as string) || null,
      zaloUsername: String((raw.username ?? '') as string) || null,
    },
  };
}

// ── Main entry ──────────────────────────────────────────────────────────────

/**
 * Full sync Friend list cho 1 nick từ Zalo SDK → CRM.
 *
 * Idempotent + best-effort:
 *  - Re-run an toàn (dedup qua @@unique([zaloAccountId, zaloUidInNick]))
 *  - SDK lỗi → catch + logActivity, không throw
 *  - Cooldown manual: trả {skipped:'cooldown'} nhanh (cron/connect bypass)
 */
export async function syncFriendsForAccount(
  accountId: string,
  orgId: string,
  opts: SyncFriendsOptions,
): Promise<SyncFriendsResult> {
  const startedAt = Date.now();
  const result: SyncFriendsResult = {
    liveCount: 0,
    createdContacts: 0,
    upsertedFriends: 0,
    newFriends: 0,
    skippedUnchanged: 0,
    updatedFriends: 0,
    emittedCount: 0,
    errors: 0,
    durationMs: 0,
    skipped: null,
  };

  // Cooldown gate cho manual trigger only
  if (opts.trigger === 'manual') {
    const lastAt = lastManualSyncAt.get(accountId) || 0;
    if (Date.now() - lastAt < COOLDOWN_MS) {
      result.skipped = 'cooldown';
      result.durationMs = Date.now() - startedAt;
      return result;
    }
    lastManualSyncAt.set(accountId, Date.now());
  }

  let liveFriends: Array<Record<string, unknown>> = [];
  let sentRequests: Array<Record<string, unknown>> = [];

  // B4 fix — SDK errors PHẢI throw lên outer catch để increment errors + logActivity.
  // Trước đây `.catch(() => [])` swallow lỗi → Zalo disconnect/rate-limit hiện liveCount=0
  // không phân biệt với "0 friends" thật, sale không biết sync fail.
  // Defensive Array.isArray normalize giữ nguyên (cho shape variants), nhưng lỗi SDK
  // (rate limit, network) bubble lên outer try/catch.
  try {
    const liveRaw: any = await withZaloRetry('getAllFriends', () => zaloOps.getAllFriends(accountId));
    const sentRaw: any = await withZaloRetry('getSentFriendRequests', () => zaloOps.getSentFriendRequests(accountId));
    liveFriends = Array.isArray(liveRaw) ? liveRaw
      : Array.isArray(liveRaw?.data) ? liveRaw.data
      : Array.isArray(liveRaw?.items) ? liveRaw.items
      : [];
    sentRequests = Array.isArray(sentRaw) ? sentRaw
      : Array.isArray(sentRaw?.data) ? sentRaw.data
      : Array.isArray(sentRaw?.items) ? sentRaw.items
      : [];
  } catch (err) {
    result.errors++;
    logger.warn(`[friend-sync:${accountId}] SDK fetch failed:`, err);
    await logSyncError(orgId, accountId, opts.trigger, err, { phase: 'sdk_fetch' });
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // ── 1. Loại trùng UID ngay trong lô ────────────────────────────────────
  // Cùng 1 UID có thể xuất hiện nhiều lần trong getAllFriends, hoặc có mặt ở CẢ
  // getAllFriends VÀ getSentFriendRequests. Trước đây 2 vòng lặp riêng xử lý tuần
  // tự nên vòng pending GHI ĐÈ accepted → KH đã là bạn bị hạ về "đang chờ".
  // Gom về 1 map: accepted luôn thắng pending_sent.
  const batch = new Map<string, BatchItem>();
  for (const live of liveFriends) {
    const info = extractFriendInfo(live);
    if (!info) continue;
    const prev = batch.get(info.uid);
    if (prev) {
      // Trùng trong lô → merge snapshot. CHỈ ghi đè bằng giá trị có thật:
      // bản ghi sau thiếu field (avatar/globalId rỗng) không được xoá giá trị
      // bản ghi trước đã có, nếu không sẽ sinh patch null giả và wipe dữ liệu.
      prev.snapshot = mergeSnapshot(prev.snapshot, info.snapshot);
    } else {
      batch.set(info.uid, { uid: info.uid, snapshot: info.snapshot, targetStatus: 'accepted' });
    }
  }
  for (const req of sentRequests) {
    const info = extractFriendInfo(req);
    if (!info) continue;
    // Đã có ở trạng thái accepted → KHÔNG hạ cấp xuống pending
    if (batch.has(info.uid)) continue;
    batch.set(info.uid, { uid: info.uid, snapshot: info.snapshot, targetStatus: 'pending_sent' });
  }

  // Số bạn bè DUY NHẤT thực tế sau khi loại trùng
  result.liveCount = batch.size;

  // Zalo không trả bạn nào → không có gì để đối chiếu, khỏi chạm DB.
  if (batch.size === 0) {
    result.durationMs = Date.now() - startedAt;
    logger.info(`[friend-sync:${accountId}] trigger=${opts.trigger} live=0 — không có bạn nào để đồng bộ`);
    return result;
  }

  // ── 2. Nạp sẵn Friend row đã có — 1 query, không N+1 ───────────────────
  // friendshipStatus BẮT BUỘC có trong select: đây là cơ sở để biết KH này đã
  // đồng bộ rồi và trạng thái còn đúng hay không. Thiếu nó thì không thể phân
  // biệt "đã có, không đổi" với "cần ghi lại".
  const existingFriends = await prisma.friend.findMany({
    where: {
      zaloAccountId: accountId,
      zaloUidInNick: { in: [...batch.keys()] },
    },
    select: {
      id: true,
      contactId: true,
      zaloUidInNick: true,
      friendshipStatus: true,
      zaloDisplayName: true,
      zaloAvatarUrl: true,
      zaloGlobalId: true,
      zaloUsername: true,
    },
  });
  const existingByUid = new Map(existingFriends.map((f) => [f.zaloUidInNick, f]));

  // ── 3. Phân loại từng UID: MỚI / KHÔNG ĐỔI / CÓ ĐỔI ────────────────────
  for (const item of batch.values()) {
    try {
      const existing = existingByUid.get(item.uid);

      // (a) KH CHƯA CÓ trong hệ thống → xử lý đầy đủ (resolve/tạo Contact + transition)
      if (!existing) {
        await processFriend({
          accountId,
          orgId,
          uid: item.uid,
          snapshot: item.snapshot,
          targetStatus: item.targetStatus,
          fallbackName: item.snapshot.zaloDisplayName,
          fallbackAvatar: item.snapshot.zaloAvatarUrl,
          existing: undefined,
          io: opts.io ?? null,
          result,
        });
        result.newFriends++;
        result.upsertedFriends++;
        continue;
      }

      // (b) Đã có → so sánh để biết có cần ghi gì không.
      const patch = computeDiff(
        {
          zaloDisplayName: existing.zaloDisplayName,
          zaloAvatarUrl: existing.zaloAvatarUrl,
          zaloGlobalId: existing.zaloGlobalId,
          zaloUsername: existing.zaloUsername,
        },
        item.snapshot,
      );
      // friendshipStatus thiếu/khác target → cần chạy state machine.
      // Thiếu thì coi như cần chạy (fail-open, thà làm thừa hơn bỏ sót trạng thái).
      const needsTransition = existing.friendshipStatus !== item.targetStatus;

      if (!needsTransition && Object.keys(patch).length === 0) {
        // KHÔNG ĐỔI GÌ → giữ nguyên, bỏ qua sạch: không query, không ghi, không emit.
        // Đây là nhánh chiếm ~100% ở lần sync thứ 2+ của 1 nick ổn định.
        result.skippedUnchanged++;
        continue;
      }

      await syncExistingFriend({
        accountId,
        orgId,
        uid: item.uid,
        existing,
        targetStatus: item.targetStatus,
        patch,
        needsTransition,
        io: opts.io ?? null,
        result,
      });
      result.updatedFriends++;
      result.upsertedFriends++;
    } catch (err) {
      result.errors++;
      logger.warn(`[friend-sync:${accountId}] process uid=${item.uid} failed:`, err);
      await logSyncError(orgId, accountId, opts.trigger, err, {
        phase: existingByUid.has(item.uid) ? 'process_existing' : 'process_new',
        uid: item.uid,
      });
    }
  }

  result.durationMs = Date.now() - startedAt;
  logger.info(
    `[friend-sync:${accountId}] trigger=${opts.trigger} live=${result.liveCount} new=${result.newFriends} updated=${result.updatedFriends} unchanged=${result.skippedUnchanged} emitted=${result.emittedCount} created=${result.createdContacts} errors=${result.errors} dur=${result.durationMs}ms`,
  );
  return result;
}

// ── Per-friend processing ──────────────────────────────────────────────────

/** 1 KH trong lô sau khi loại trùng UID. */
interface BatchItem {
  uid: string;
  snapshot: DiffSnapshot;
  targetStatus: 'accepted' | 'pending_sent';
}

/** Friend row đã có trong DB (kết quả pre-load 1 query). */
interface ExistingFriendRow {
  id: string;
  contactId: string;
  zaloUidInNick: string;
  friendshipStatus: string;
  zaloDisplayName: string | null;
  zaloAvatarUrl: string | null;
  zaloGlobalId: string | null;
  zaloUsername: string | null;
}

interface ProcessFriendArgs {
  accountId: string;
  orgId: string;
  uid: string;
  snapshot: DiffSnapshot;
  targetStatus: 'accepted' | 'pending_sent';
  fallbackName: string | null | undefined;
  fallbackAvatar: string | null | undefined;
  existing: ExistingFriendRow | undefined;
  io: Server | null;
  result: SyncFriendsResult;
}

/**
 * KH ĐÃ CÓ Friend row và có thứ thực sự đổi → chỉ ghi phần đổi.
 *
 * Khác processFriend ở chỗ KHÔNG resolve lại Contact: contactId đã nằm sẵn trong
 * Friend row nên bỏ được 1-2 query contact.findFirst mỗi KH. Và applyFriendTransition
 * (transaction: findUnique + upsert + counter + claim assignedUser) chỉ chạy khi
 * trạng thái kết bạn thật sự đổi, thay vì chạy cho mọi KH mỗi 15 phút như trước.
 */
async function syncExistingFriend(args: {
  accountId: string;
  orgId: string;
  uid: string;
  existing: ExistingFriendRow;
  targetStatus: 'accepted' | 'pending_sent';
  patch: DiffSnapshot;
  needsTransition: boolean;
  io: Server | null;
  result: SyncFriendsResult;
}): Promise<void> {
  // Trạng thái kết bạn đổi → chạy state machine để counter Contact + claim
  // assignedUser đúng. source='sync' để không set becameFriendAt sai.
  if (args.needsTransition) {
    await applyFriendTransition({
      orgId: args.orgId,
      zaloAccountId: args.accountId,
      contactId: args.existing.contactId,
      zaloUidInNick: args.uid,
      newFriendshipStatus: args.targetStatus,
      source: 'sync',
    });
  }

  // Danh tính không drift → xong, không ghi thêm, không emit.
  if (Object.keys(args.patch).length === 0) return;

  const updated = await prisma.friend.update({
    where: {
      zaloAccountId_zaloUidInNick: {
        zaloAccountId: args.accountId,
        zaloUidInNick: args.uid,
      },
    },
    data: args.patch,
    select: { id: true, contactId: true, zaloAccountId: true, zaloUidInNick: true },
  });

  if (args.io) {
    const payload = buildFriendUpdatedPayload({
      friendId: updated.id,
      contactId: updated.contactId,
      zaloAccountId: updated.zaloAccountId,
      zaloUidInNick: updated.zaloUidInNick,
      patch: args.patch,
    });
    args.io.to(`org:${args.orgId}`).emit('friend:updated', payload);
    args.result.emittedCount++;
  }
}

async function processFriend(args: ProcessFriendArgs): Promise<void> {
  // 1. Resolve or create Contact.
  //    Memory anh: per-account zaloUid khác nhau cho cùng person → KHÔNG được dedup
  //    theo zaloUid only (sẽ tạo duplicate Contact cho mỗi nick nhìn cùng KH).
  //    Phải dedup theo zaloGlobalId (cross-nick canonical) khi có, fallback zaloUid.
  //    Bug Codex flagged + memory: Phong Lam 2 Contacts vì cùng KH 2 nick → 2 zaloUid.
  const globalId = args.snapshot.zaloGlobalId;
  let contact: { id: string; fullName: string | null } | null = null;

  // 1a. Dedup priority 1 — match zaloGlobalId (canonical, cross-nick).
  // KHÔNG filter mergedInto:null vì @@unique([orgId, zaloGlobalId]) apply cả
  // merged Contact → nếu skip merged sẽ Race: pre-check miss, create thì
  // UniqueConstraint violation. Match cả merged để follow chain tới root.
  if (globalId) {
    const matched = await prisma.contact.findFirst({
      where: { orgId: args.orgId, zaloGlobalId: globalId },
      select: { id: true, fullName: true, mergedInto: true },
    });
    if (matched?.mergedInto) {
      // Soft-merge target — redirect Friend về root contact thay vì merged stub
      const root = await prisma.contact.findUnique({
        where: { id: matched.mergedInto },
        select: { id: true, fullName: true },
      });
      contact = root ?? { id: matched.id, fullName: matched.fullName };
    } else if (matched) {
      contact = { id: matched.id, fullName: matched.fullName };
    }
  }
  // 1b. Fallback — match per-nick zaloUid (legacy data + khi globalId chưa pull về).
  if (!contact) {
    const matched = await prisma.contact.findFirst({
      where: { orgId: args.orgId, zaloUid: args.uid },
      select: { id: true, fullName: true, mergedInto: true },
    });
    if (matched?.mergedInto) {
      const root = await prisma.contact.findUnique({
        where: { id: matched.mergedInto },
        select: { id: true, fullName: true },
      });
      contact = root ?? { id: matched.id, fullName: matched.fullName };
    } else if (matched) {
      contact = { id: matched.id, fullName: matched.fullName };
    }
  }
  if (!contact) {
    const newContact = await prisma.contact.create({
      data: {
        id: randomUUID(),
        orgId: args.orgId,
        zaloUid: args.uid,
        zaloGlobalId: globalId || null,
        zaloUsername: args.snapshot.zaloUsername || null,
        fullName: args.fallbackName || 'Unknown',
        avatarUrl: args.fallbackAvatar || null,
        hasZalo: true,
      },
      select: { id: true, fullName: true },
    });
    contact = newContact;
    args.result.createdContacts++;
  }

  // 1c. B8 — Backfill Contact.fullName khi Contact stub 'Unknown' mà Friend đã có
  // zaloDisplayName từ SDK. Stub được tạo bởi resolveContact (friend-event-handler)
  // khi event đến trước message → fullName='Unknown'. Sau khi sync pull zaloName
  // về Friend, KH Cha vẫn stuck "Unknown" gây UI broken popup/chat.
  // Chỉ ghi đè khi fullName = 'Unknown' literal — KHÔNG đụng nếu sale đã edit thủ công.
  const newName = args.snapshot.zaloDisplayName || args.fallbackName;
  if (
    newName
    && newName !== 'Unknown'
    && (contact.fullName === 'Unknown' || contact.fullName === null || contact.fullName === '')
  ) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        fullName: newName,
        // Cũng backfill globalId/username nếu Contact thiếu (matched bằng zaloUid fallback)
        ...(globalId && !args.snapshot.zaloUsername ? { zaloGlobalId: globalId } : {}),
        ...(args.snapshot.zaloUsername ? { zaloUsername: args.snapshot.zaloUsername } : {}),
        ...(args.fallbackAvatar ? { avatarUrl: args.fallbackAvatar } : {}),
      },
    });
  }

  // 2. Drive friendship state machine (handles upsert + counter delta + assignedUser).
  // source='sync' → KHÔNG set becameFriendAt vì Zalo không trả ngày kết bạn thực
  // (sync time = today gây "Đã KB hôm nay" sai cho KH cũ).
  await applyFriendTransition({
    orgId: args.orgId,
    zaloAccountId: args.accountId,
    contactId: contact.id,
    zaloUidInNick: args.uid,
    newFriendshipStatus: args.targetStatus,
    source: 'sync',
  });
  // upsertedFriends được đếm ở vòng lặp gọi (phân loại mới/đổi), không đếm ở đây.

  // 3. Diff identity fields (name/avatar/globalId/username) → update + emit only if changed
  const existingSnap: DiffSnapshot = args.existing
    ? {
        zaloDisplayName: args.existing.zaloDisplayName,
        zaloAvatarUrl: args.existing.zaloAvatarUrl,
        zaloGlobalId: args.existing.zaloGlobalId,
        zaloUsername: args.existing.zaloUsername,
      }
    : { zaloDisplayName: null, zaloAvatarUrl: null, zaloGlobalId: null, zaloUsername: null };

  const patch = computeDiff(existingSnap, args.snapshot);
  if (Object.keys(patch).length === 0) {
    // No identity drift → skip update + skip emit
    return;
  }

  const updated = await prisma.friend.update({
    where: {
      zaloAccountId_zaloUidInNick: {
        zaloAccountId: args.accountId,
        zaloUidInNick: args.uid,
      },
    },
    data: patch,
    select: { id: true, contactId: true, zaloAccountId: true, zaloUidInNick: true },
  });

  // Emit socket patch — FE composable use-friend-socket mutate cache row
  if (args.io) {
    const payload = buildFriendUpdatedPayload({
      friendId: updated.id,
      contactId: updated.contactId,
      zaloAccountId: updated.zaloAccountId,
      zaloUidInNick: updated.zaloUidInNick,
      patch,
    });
    args.io.to(`org:${args.orgId}`).emit('friend:updated', payload);
    args.result.emittedCount++;
  }
}

// ── Full account sync wrapper (friends + aliases + labels) ────────────────

export interface SyncAccountFullyResult {
  friends: SyncFriendsResult | null;
  aliasesUpdated: number;
  labelsUpdated: number;
  errors: string[];
  durationMs: number;
  /**
   * True khi nick đang bị admin tạm dừng đồng bộ (ZaloAccount.syncPaused) —
   * không gọi Zalo, không ghi DB. Caller (route /friends-db/sync) nên báo cho
   * user biết thay vì hiện "đồng bộ xong 0 thay đổi".
   */
  syncPaused?: boolean;
}

/**
 * Sync TOÀN BỘ identity per-pair (friends + aliases + labels) cho 1 account.
 *
 * Single entry point dùng chung cho:
 *  - friend-sync-cron.ts (mỗi 15 phút loop accounts)
 *  - zalo-pool.autoSyncOnConnect (lần đầu connect)
 *  - friend-routes /friends-db/sync (manual "↻ Làm mới ngay")
 *
 * 3 nhánh chạy parallel via Promise.allSettled — 1 nhánh fail không break 2 nhánh kia.
 * (Cron loop ngoài vẫn sequential giữa accounts để tránh burst Zalo rate-limit.)
 */
export async function syncAccountFully(
  accountId: string,
  orgId: string,
  opts: SyncFriendsOptions,
): Promise<SyncAccountFullyResult> {
  const startedAt = Date.now();
  const result: SyncAccountFullyResult = {
    friends: null,
    aliasesUpdated: 0,
    labelsUpdated: 0,
    errors: [],
    durationMs: 0,
  };

  // Phase Admin Purge 2026-10-25 — nick bị admin tạm dừng đồng bộ.
  // Gate đặt ở ĐÂY (wrapper) vì cả 3 trigger — cron 15', autoSyncOnConnect,
  // nút "Làm mới ngay" — đều đi qua syncAccountFully. Không gate thì dữ liệu KH
  // admin vừa xoá sẽ bị hút về nguyên vẹn trong ≤15 phút.
  const gate = await prisma.zaloAccount.findUnique({
    where: { id: accountId },
    select: { syncPaused: true },
  });
  if (gate?.syncPaused) {
    logger.info(`[friend-sync-full:${accountId}] Bỏ qua — admin đã tạm dừng đồng bộ cho nick này`);
    result.syncPaused = true;
    result.durationMs = Date.now() - startedAt;
    return result;
  }

  // B5 fix — labels full-sync internally calls syncAliasesForAccount (alias-sync.ts
  // imported lazy inside syncLabelsForAccount full path). Wrapper bỏ alias parallel
  // để tránh double getAliasList pagination + DB diff cùng account mỗi cycle.
  // Result: 2 nhánh parallel thay vì 3 (friends + labels). aliasesUpdated lấy từ
  // labelsRes.aliasesUpdated do syncLabelsForAccount propagate qua.
  const [friendsRes, labelsRes] = await Promise.allSettled([
    syncFriendsForAccount(accountId, orgId, opts),
    (async () => {
      const { syncLabelsIfStale } = await import('./zalo-labels-routes.js');
      return syncLabelsIfStale(accountId, orgId);
    })(),
  ]);

  if (friendsRes.status === 'fulfilled') {
    result.friends = friendsRes.value;
  } else {
    result.errors.push(`friends: ${friendsRes.reason instanceof Error ? friendsRes.reason.message : String(friendsRes.reason)}`);
  }
  if (labelsRes.status === 'fulfilled') {
    // syncLabelsIfStale có thể trả null (cooldown / grace) → coi như 0
    result.labelsUpdated = labelsRes.value?.friendsUpdated ?? 0;
    result.aliasesUpdated = labelsRes.value?.aliasesUpdated ?? 0;
  } else {
    result.errors.push(`labels: ${labelsRes.reason instanceof Error ? labelsRes.reason.message : String(labelsRes.reason)}`);
  }

  // B8 sweep mở rộng — backfill TẤT CẢ identity field cho Contact stub khi Friend
  // có data hơn. KHÔNG overwrite data sale đã edit:
  //   - full_name: chỉ ghi đè khi NULL/''/literal 'Unknown' (treat stub)
  //   - zalo_global_id / zalo_username / avatar_url: chỉ ghi đè khi NULL
  //     (COALESCE — sale edit avatar tay sẽ không bị reset)
  // Coverage:
  //   1. Pending_received friends (không vào getAllFriends/getSentFriendRequests loop)
  //   2. Legacy Contact tạo từ friend-event-handler/applyFriendAggregate trước Phase 6
  //      (chỉ có UID, thiếu globalId/username — sweep này fill)
  //   3. Khi user dùng UI tạo Contact manual sau đó nick CRM nhận message từ KH đó
  //
  // Sau khi sweep, Contact của cùng KH 2 nick chăm sẽ cùng zalo_global_id →
  // duplicate-detector cron 02:30 UTC sẽ auto-merge step 1 (cùng globalId).
  // Single UPDATE…FROM atomic, dùng index (org_id, zalo_global_id) + FK, <100ms cho ~3k friends.
  try {
    // CRITICAL — phải tránh @@unique([org_id, zalo_global_id]) violation khi
    // Contact A NULL globalId, Contact B đã có globalId X, cùng person 2 nicks.
    // NOT EXISTS subquery: chỉ set globalId nếu KHÔNG có Contact khác cùng org
    // đã claim globalId này. Trường hợp duplicate → giữ NULL, để duplicate-detector
    // cron handle qua step khác (name+phone hoặc fuzzy match) hoặc admin run-detector.
    // Tương tự cho zalo_username (uniqueness implicit qua data sống cùng Zalo).
    const backfilled = await prisma.$executeRaw`
      UPDATE contacts
      SET
        full_name      = COALESCE(NULLIF(NULLIF(contacts.full_name, ''), 'Unknown'), sub.f_name, contacts.full_name),
        zalo_global_id = CASE
          WHEN (contacts.zalo_global_id IS NULL OR contacts.zalo_global_id = '')
            AND sub.f_global_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM contacts c2
              WHERE c2.org_id = contacts.org_id
                AND c2.id <> contacts.id
                AND c2.zalo_global_id = sub.f_global_id
            )
          THEN sub.f_global_id
          ELSE contacts.zalo_global_id
        END,
        zalo_username  = COALESCE(contacts.zalo_username, sub.f_username),
        avatar_url     = COALESCE(contacts.avatar_url, sub.f_avatar)
      FROM (
        SELECT DISTINCT ON (f.contact_id)
          f.contact_id,
          f.zalo_display_name AS f_name,
          f.zalo_global_id    AS f_global_id,
          f.zalo_username     AS f_username,
          f.zalo_avatar_url   AS f_avatar
        FROM friends f
        WHERE f.org_id = ${orgId}
          AND f.zalo_account_id = ${accountId}
          AND (
            f.zalo_display_name IS NOT NULL AND f.zalo_display_name <> '' AND f.zalo_display_name <> 'Unknown'
            OR f.zalo_global_id IS NOT NULL AND f.zalo_global_id <> ''
            OR f.zalo_username IS NOT NULL AND f.zalo_username <> ''
            OR f.zalo_avatar_url IS NOT NULL AND f.zalo_avatar_url <> ''
          )
        ORDER BY f.contact_id, f.updated_at DESC
      ) sub
      WHERE contacts.id = sub.contact_id
        AND contacts.org_id = ${orgId}
        AND (
          (contacts.full_name IS NULL OR contacts.full_name = '' OR contacts.full_name = 'Unknown') AND sub.f_name IS NOT NULL
          OR (contacts.zalo_global_id IS NULL OR contacts.zalo_global_id = '') AND sub.f_global_id IS NOT NULL
          OR (contacts.zalo_username IS NULL OR contacts.zalo_username = '') AND sub.f_username IS NOT NULL
          OR (contacts.avatar_url IS NULL OR contacts.avatar_url = '') AND sub.f_avatar IS NOT NULL
        )
    `;
    if (backfilled > 0) {
      logger.info(`[friend-sync-full:${accountId}] B8 backfill sweep: ${backfilled} Contact stubs filled (full_name + global_id + username + avatar from Friend)`);
    }
  } catch (err) {
    logger.warn(`[friend-sync-full:${accountId}] B8 backfill sweep failed:`, err);
  }

  result.durationMs = Date.now() - startedAt;
  logger.info(
    `[friend-sync-full:${accountId}] trigger=${opts.trigger} friends_emitted=${result.friends?.emittedCount ?? 0} aliases=${result.aliasesUpdated} labels=${result.labelsUpdated} errors=${result.errors.length} dur=${result.durationMs}ms`,
  );
  return result;
}

// ── Error logging helper ───────────────────────────────────────────────────

async function logSyncError(
  orgId: string,
  accountId: string,
  trigger: SyncTrigger,
  err: unknown,
  extra: Record<string, unknown>,
): Promise<void> {
  try {
    await logActivity({
      orgId,
      systemSource: 'friend_sync_error',
      action: 'sync_failed',
      entityType: 'zalo_account',
      entityId: accountId,
      details: {
        trigger,
        error: err instanceof Error ? err.message : String(err),
        ...extra,
      },
    });
  } catch {
    // Don't recurse on log failure
  }
}
