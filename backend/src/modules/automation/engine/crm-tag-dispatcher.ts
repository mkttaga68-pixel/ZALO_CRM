/**
 * crm-tag-dispatcher.ts — outbox worker cho event `crm_tag_added` (2026-10-25).
 *
 * Nối crm_tag_events (ghi bởi contacts/crm-tag-event-service trong cùng
 * transaction với việc gắn tag) vào campaign-materializer ĐANG CÓ.
 *
 * Vì sao không emit thẳng automationEventBus ở chỗ gắn tag:
 *  - Bus là EventEmitter in-memory + setImmediate. Gắn tag xong mà process chết
 *    trước khi listener chạy là mất event, KH không bao giờ vào sequence.
 *  - Bus không trả kết quả, nên không ghi được "đã enroll mấy task" hay "vì sao
 *    bỏ qua" — Phase 3 yêu cầu nhật ký lỗi và lý do bỏ qua.
 *  - Gửi tin có thể timeout KHÔNG RÕ KẾT QUẢ. Phải có state để dừng, không tự
 *    gửi lại.
 *
 * Nên dispatcher gọi `materializeFromEvent()` TRỰC TIẾP (đó chính là trigger
 * dispatcher hiện có) chứ không qua bus — để lấy được MaterializeResult. Không
 * emit lên bus song song, vì listener duy nhất của bus cũng là materializer →
 * emit nữa là enroll 2 lần.
 *
 * State machine:
 *   pending → dispatching → done | skipped | failed | unknown
 *
 * `unknown` = đã gọi materializer nhưng không biết nó có tạo task hay không
 * (lỗi hạ tầng giữa đường). KHÔNG tự retry: thà thiếu 1 tin còn hơn KH nhận 2
 * tin. Người vận hành xem bảng rồi quyết định.
 */
import { prisma } from '../../../shared/database/prisma-client.js';
import { logger } from '../../../shared/utils/logger.js';
import { checkPolicy } from '../../../core/runtime-policy.js';
import { materializeFromEvent } from './campaign-materializer.js';
import { logActivity } from '../../activity/activity-logger.js';
import type { AutomationEvent } from './types.js';

/** Quét lại outbox mỗi 60s — bắt các event pending bị bỏ sót do restart. */
const SWEEP_INTERVAL_MS = 60_000;
/** Mỗi lượt quét xử lý tối đa 20 event, tránh một lượt chiếm DB quá lâu. */
const SWEEP_BATCH = 20;
/**
 * Event 'dispatching' quá 5 phút coi như process chết giữa đường. Đưa về pending
 * để thử lại — giống cơ chế lease recovery của task-worker. An toàn vì
 * materializer idempotent theo (campaignId, contactId).
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;
/**
 * Bỏ qua event cũ hơn 24h. Lý do: tag gắn hôm qua mà hôm nay mới gửi tin chăm
 * sóc "ngày 1" là sai nghiệp vụ và dễ làm KH hoảng. Giống `stale_scheduled_at`
 * của task-worker.
 */
const STALE_AFTER_MS = 24 * 3600 * 1000;
/** Số lần thử lại tối đa trước khi bỏ cuộc (lỗi hạ tầng tạm thời). */
const MAX_ATTEMPTS = 3;

let sweeperHandle: NodeJS.Timeout | null = null;
let sweeping = false;

// ── Kết quả dispatch ───────────────────────────────────────────────────────

export type DispatchOutcome = 'done' | 'skipped' | 'failed' | 'unknown' | 'not_claimed';

export interface DispatchResult {
  outcome: DispatchOutcome;
  reason?: string;
  tasksEnqueued?: number;
  campaignsCreated?: number;
  /** Tên trigger / sequence đã khớp — để Timeline KH hiển thị không cần join. */
  triggerName?: string;
  sequenceName?: string | null;
}

// ── Safety gates (Phase 3) ────────────────────────────────────────────────

/**
 * Theo chuỗi `mergedInto` về KH canonical.
 *
 * CHỈ theo mergedInto (hard-merge: bản ghi phụ đã bị ẩn, mọi thứ thuộc về bản
 * ghi chính). KHÔNG theo parentContactId: đó là soft-link cấp người, KH con vẫn
 * hiện và chính KH con mới là bên giữ Zalo identity để gửi tin — enroll KH cha
 * thay con là gửi sai người.
 *
 * Giới hạn 10 bước để một chuỗi lỗi (vòng tròn) không treo worker.
 */
async function resolveCanonicalContactId(
  orgId: string,
  contactId: string,
): Promise<{ id: string; consentStatus: string; hiddenAt: Date | null } | null> {
  let currentId = contactId;
  for (let hop = 0; hop < 10; hop++) {
    const row = await prisma.contact.findFirst({
      where: { id: currentId, orgId },
      select: { id: true, mergedInto: true, consentStatus: true, hiddenAt: true },
    });
    if (!row) return null;
    if (!row.mergedInto || row.mergedInto === row.id) {
      return { id: row.id, consentStatus: row.consentStatus, hiddenAt: row.hiddenAt };
    }
    currentId = row.mergedInto;
  }
  logger.warn(`[crm-tag-dispatcher] chuỗi mergedInto quá sâu từ contact=${contactId}`);
  return null;
}

// ── Dispatch 1 event ──────────────────────────────────────────────────────

/**
 * Claim atomic rồi dispatch 1 event. An toàn khi gọi đồng thời nhiều lần cho
 * cùng id: chỉ 1 lần claim được, các lần khác trả 'not_claimed'.
 */
export async function dispatchCrmTagEvent(eventId: string): Promise<DispatchResult> {
  // ── Atomic claim: pending → dispatching ────────────────────────────────
  // updateMany + điều kiện state là cách claim không cần SELECT FOR UPDATE;
  // cùng pattern với task-worker.processTask.
  const claim = await prisma.crmTagEvent.updateMany({
    where: { id: eventId, state: 'pending' },
    data: { state: 'dispatching', claimedAt: new Date(), attemptCount: { increment: 1 } },
  });
  if (claim.count === 0) return { outcome: 'not_claimed' };

  const event = await prisma.crmTagEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true, orgId: true, contactId: true, crmTagId: true, tagName: true,
      actorUserId: true, source: true, occurredAt: true, attemptCount: true,
    },
  });
  if (!event) return { outcome: 'not_claimed' };

  try {
    const result = await runGatesAndMaterialize(event);
    await finalize(event, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Lỗi sau khi materializer có thể đã tạo task → KHÔNG biết đã gửi hay chưa.
    // Hết lượt thử thì chốt 'unknown' (không tự gửi lại), còn lượt thì về pending.
    const outcome: DispatchOutcome = event.attemptCount >= MAX_ATTEMPTS ? 'unknown' : 'failed';
    await prisma.crmTagEvent.update({
      where: { id: event.id },
      data: {
        state: outcome === 'unknown' ? 'unknown' : 'pending',
        lastError: msg.slice(0, 1000),
        ...(outcome === 'unknown' ? { dispatchedAt: new Date() } : {}),
      },
    });
    logger.error(`[crm-tag-dispatcher] event=${event.id} lỗi (lần ${event.attemptCount}): ${msg}`);
    return { outcome, reason: msg };
  }
}

interface ClaimedEvent {
  id: string; orgId: string; contactId: string; crmTagId: string; tagName: string;
  actorUserId: string | null; source: string; occurredAt: Date; attemptCount: number;
}

async function runGatesAndMaterialize(event: ClaimedEvent): Promise<DispatchResult> {
  // ── Gate 1: chỉ nguồn "nhân viên chủ động gắn trong CRM" được gửi ──────
  if (event.source !== 'crm_manual') {
    return { outcome: 'skipped', reason: `source='${event.source}' không được dispatch` };
  }

  // ── Gate 2: event quá cũ ───────────────────────────────────────────────
  const ageMs = Date.now() - event.occurredAt.getTime();
  if (ageMs > STALE_AFTER_MS) {
    return { outcome: 'skipped', reason: `event cũ ${Math.round(ageMs / 3600000)}h (> 24h)` };
  }

  // ── Gate 3: KH canonical + còn tồn tại trong org ───────────────────────
  const canonical = await resolveCanonicalContactId(event.orgId, event.contactId);
  if (!canonical) {
    return { outcome: 'skipped', reason: 'không resolve được KH canonical trong org' };
  }

  // ── Gate 4: consent / opt-out ──────────────────────────────────────────
  // Contact.consentStatus: implicit | granted | revoked. 'revoked' = KH đã yêu
  // cầu dừng nhận tin → KHÔNG gửi, bất kể trigger bật hay tắt.
  if (canonical.consentStatus === 'revoked') {
    return { outcome: 'skipped', reason: 'KH đã opt-out (consentStatus=revoked)' };
  }

  // ── Gate 5: quyền của nhân viên với KH ─────────────────────────────────
  // Endpoint gắn tag đã check 'contact.view' rồi; check lại ở đây là lớp 2 cho
  // trường hợp quyền bị thu hồi giữa lúc gắn tag và lúc dispatch. Community
  // chưa register policy → trả TRUE, không đổi hành vi.
  if (event.actorUserId) {
    const allowed = await checkPolicy('contact.view', {
      req: null,
      userId: event.actorUserId,
      orgId: event.orgId,
      resourceId: canonical.id,
    });
    if (!allowed) {
      return { outcome: 'skipped', reason: 'nhân viên không còn quyền với KH này' };
    }
  }

  // ── Gate 6: có trigger nào đang bật khớp tag này không ─────────────────
  // Chọn trigger bằng ID tag + organization (không dùng tên: rename tag không
  // được làm trigger trỏ sai). eventFilter.crmTagId là nơi UI lưu tag kích hoạt.
  const triggers = await prisma.automationTrigger.findMany({
    where: { orgId: event.orgId, eventType: 'crm_tag_added', enabled: true },
    select: {
      id: true, name: true, eventFilter: true, createdAt: true,
      sequence: { select: { id: true, name: true } },
    },
  });
  const matching = triggers.filter((t) => {
    const f = t.eventFilter as Record<string, unknown> | null;
    return f?.crmTagId === event.crmTagId;
  });
  if (matching.length === 0) {
    return { outcome: 'skipped', reason: 'không có trigger nào đang bật cho tag này' };
  }

  // ── Gate 7: KHÔNG chạy tag lịch sử khi trigger vừa được tạo ────────────
  // Tag gắn TRƯỚC khi trigger tồn tại thì không được kích hoạt — nếu không, bật
  // trigger lần đầu sẽ bắn hàng loạt tin cho mọi KH đã có tag từ trước.
  // (Thực tế event chỉ sinh từ lúc tính năng này chạy nên tag lịch sử không có
  //  event nào; đây là chốt an toàn cho trường hợp xoá-rồi-tạo-lại trigger.)
  const fresh = matching.filter((t) => event.occurredAt >= t.createdAt);
  if (fresh.length === 0) {
    return {
      outcome: 'skipped',
      reason: 'tag được gắn trước khi trigger được tạo (không chạy tag lịch sử)',
    };
  }

  // ── Materialize qua dispatcher CÓ SẴN ──────────────────────────────────
  // contactId trong event = ĐÚNG 1 khách. campaign-materializer thấy
  // event.contactId thì resolveSegmentContactIds trả về đúng [contactId] đó,
  // KHÔNG query segment → không thể gửi lan sang KH khác cùng tag.
  const automationEvent: AutomationEvent = {
    type: 'crm_tag_added',
    orgId: event.orgId,
    occurredAt: event.occurredAt,
    contactId: canonical.id,
    payload: {
      crmTagId: event.crmTagId,
      tagName: event.tagName,
      actorUserId: event.actorUserId,
      eventId: event.id,
      source: event.source,
    },
  };

  const mat = await materializeFromEvent(automationEvent);

  if (mat.tasksEnqueued === 0) {
    return {
      outcome: 'skipped',
      reason: mat.reasons.length ? mat.reasons.join('; ').slice(0, 500) : 'không có task nào được tạo',
      campaignsCreated: mat.campaignsCreated,
      tasksEnqueued: 0,
    };
  }

  return {
    outcome: 'done',
    tasksEnqueued: mat.tasksEnqueued,
    campaignsCreated: mat.campaignsCreated,
    // Tên để Timeline KH đọc được "vào kịch bản nào" mà không phải join thêm.
    triggerName: fresh.map((t) => t.name).join(', '),
    sequenceName: fresh.map((t) => t.sequence?.name).filter(Boolean).join(', ') || null,
  };
}

/** Ghi kết quả vào event + ghi Timeline KH. */
async function finalize(event: ClaimedEvent, result: DispatchResult): Promise<void> {
  await prisma.crmTagEvent.update({
    where: { id: event.id },
    data: {
      state: result.outcome === 'not_claimed' ? 'pending' : result.outcome,
      dispatchedAt: new Date(),
      lastError: result.outcome === 'done' ? null : (result.reason ?? null),
      result: {
        tasksEnqueued: result.tasksEnqueued ?? 0,
        campaignsCreated: result.campaignsCreated ?? 0,
        reason: result.reason ?? null,
        triggerName: result.triggerName ?? null,
        sequenceName: result.sequenceName ?? null,
      },
    },
  });

  // Timeline KH: nhân viên thấy "gắn tag xong thì hệ thống làm gì".
  logActivity({
    orgId: event.orgId,
    userId: event.actorUserId,
    systemSource: event.actorUserId ? undefined : 'crm-tag-dispatcher',
    action: result.outcome === 'done' ? 'crm_tag_sequence_enrolled' : 'crm_tag_sequence_skipped',
    entityType: 'contact',
    entityId: event.contactId,
    details: {
      tag: event.tagName,
      crmTagId: event.crmTagId,
      eventId: event.id,
      tasksEnqueued: result.tasksEnqueued ?? 0,
      reason: result.reason ?? null,
      triggerName: result.triggerName ?? null,
      sequenceName: result.sequenceName ?? null,
    },
  });

  logger.info(
    `[crm-tag-dispatcher] event=${event.id} tag="${event.tagName}" → ${result.outcome}`
    + (result.reason ? ` (${result.reason})` : '')
    + (result.tasksEnqueued ? ` task=${result.tasksEnqueued}` : ''),
  );
}

/**
 * Dispatch ngay sau khi transaction gắn tag commit. Fire-and-forget: lỗi ở đây
 * KHÔNG được làm fail response gắn tag — event đã nằm trong outbox, sweeper sẽ
 * lo. Dùng ở contact-routes.
 */
export function dispatchCrmTagEventsSoon(eventIds: string[]): void {
  if (eventIds.length === 0) return;
  void (async () => {
    for (const id of eventIds) {
      try {
        await dispatchCrmTagEvent(id);
      } catch (err) {
        logger.error(`[crm-tag-dispatcher] dispatch ngay thất bại cho event=${id}:`, err);
      }
    }
  })();
}

// ── Sweeper ───────────────────────────────────────────────────────────────

/** Một lượt quét — export để test và chạy tay. */
export async function sweepCrmTagEvents(): Promise<number> {
  if (sweeping) return 0;
  sweeping = true;
  try {
    // Thu hồi lease: 'dispatching' quá hạn → pending.
    const reclaimed = await prisma.crmTagEvent.updateMany({
      where: { state: 'dispatching', claimedAt: { lt: new Date(Date.now() - CLAIM_LEASE_MS) } },
      data: { state: 'pending' },
    });
    if (reclaimed.count > 0) {
      logger.warn(`[crm-tag-dispatcher] thu hồi ${reclaimed.count} event treo ở 'dispatching'`);
    }

    // Quá số lần thử → chốt 'unknown', không gửi nữa.
    await prisma.crmTagEvent.updateMany({
      where: { state: 'pending', attemptCount: { gte: MAX_ATTEMPTS } },
      data: { state: 'unknown', dispatchedAt: new Date() },
    });

    const pending = await prisma.crmTagEvent.findMany({
      where: { state: 'pending' },
      orderBy: { occurredAt: 'asc' },
      take: SWEEP_BATCH,
      select: { id: true },
    });
    for (const p of pending) {
      await dispatchCrmTagEvent(p.id);
    }
    return pending.length;
  } catch (err) {
    logger.error('[crm-tag-dispatcher] lỗi sweep:', err);
    return 0;
  } finally {
    sweeping = false;
  }
}

export function startCrmTagEventSweeper(): void {
  if (sweeperHandle) {
    logger.warn('[crm-tag-dispatcher] sweeper đã chạy');
    return;
  }
  sweeperHandle = setInterval(() => void sweepCrmTagEvents(), SWEEP_INTERVAL_MS);
  logger.info(`[crm-tag-dispatcher] sweeper chạy mỗi ${SWEEP_INTERVAL_MS / 1000}s`);
  void sweepCrmTagEvents();
}

export function stopCrmTagEventSweeper(): void {
  if (sweeperHandle) {
    clearInterval(sweeperHandle);
    sweeperHandle = null;
    logger.info('[crm-tag-dispatcher] sweeper đã dừng');
  }
}
