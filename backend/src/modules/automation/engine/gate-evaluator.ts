// Phase 7 Engine — Gate evaluator.
//
// Gates are checked SEQUENTIALLY before executing a task action. Short-circuits
// on first failure. Memory rules locked here (anh chốt):
//   - allowedHourRange [6, 22]
//   - randomDelayPerSend (applied at scheduling, not gate-check)
//   - perNickThrottle (last_friend_req_sent_at / last_message_sent_at per nick)
//   - crossNickRecencyDays (skip if any nick had recent activity with KH)
//   - stopOnAccept (skip if Contact.acceptedNicksCount > 0)
//
// Gates are PURE for unit-testing — DB lookups happen in caller (task-worker)
// which then passes the read values into these functions.

import type { SequenceRuntimeRules, GateResult } from './types.js';
import type { BlockActionType } from '../blocks/types.js';

// ── Pure gate functions ───────────────────────────────────────────────────

/**
 * Consent / opt-out gate (2026-10-25).
 *
 * Contact.consentStatus: 'implicit' | 'granted' | 'revoked'. Cột này đã tồn tại
 * từ lâu nhưng engine CHƯA HỀ đọc — tức automation vẫn gửi cho KH đã yêu cầu
 * dừng nhận tin. Gate này đóng lỗ đó.
 *
 * Chỉ chặn 'revoked'. 'implicit' KHÔNG chặn: đó là mặc định của mọi KH đang có
 * trong hệ thống, chặn nó sẽ dừng toàn bộ automation đang chạy.
 *
 * Áp cho hành động gửi ra ngoài (gửi tin / mời kết bạn). update_status là ghi DB
 * nội bộ, không liên quan consent.
 */
export function checkConsent(
  actionType: BlockActionType,
  consentStatus: string | null | undefined,
): GateResult {
  if (actionType !== 'send_message' && actionType !== 'request_friend') {
    return { passed: true };
  }
  if (consentStatus !== 'revoked') return { passed: true };
  return {
    passed: false,
    failedGate: 'consent_revoked',
    detail: 'KH đã opt-out (consentStatus=revoked) — không gửi',
  };
}

// Hour range gate — returns retryAfter for next valid window if blocked.
export function checkHourRange(
  now: Date,
  rules: SequenceRuntimeRules,
): GateResult {
  const range = rules.allowedHourRange;
  if (!range) return { passed: true };
  const [start, end] = range;
  const hour = now.getHours();
  if (hour >= start && hour <= end) {
    return { passed: true };
  }
  // Compute next valid window:
  //   if hour < start: today at `start`
  //   if hour > end: tomorrow at `start`
  const retryAfter = new Date(now);
  if (hour < start) {
    retryAfter.setHours(start, 0, 0, 0);
  } else {
    retryAfter.setDate(retryAfter.getDate() + 1);
    retryAfter.setHours(start, 0, 0, 0);
  }
  return {
    passed: false,
    failedGate: 'hour_range',
    detail: `Outside hours [${start}:00 - ${end}:00], retry at ${retryAfter.toISOString()}`,
    retryAfter,
  };
}

// Per-nick throttle gate — checks if minDelay has elapsed since this nick's
// last send of the SAME action category (friend-add or message).
// `lastSentAt` is read by caller from ZaloAccount.lastFriendReqSentAt or
// lastMessageSentAt depending on actionType.
export function checkPerNickThrottle(
  now: Date,
  actionType: BlockActionType,
  lastSentAt: Date | null,
  rules: SequenceRuntimeRules,
): GateResult {
  if (!rules.perNickThrottle) return { passed: true };
  if (!lastSentAt) return { passed: true };

  const delay = rules.randomDelayPerSend;
  if (!delay) return { passed: true };

  // Use min as throttle floor — gate only blocks if not even `min` minutes
  // have elapsed. The actual jittered delay is applied at scheduleNext.
  const minMs = delay.min * 60 * 1000;
  const elapsed = now.getTime() - lastSentAt.getTime();
  if (elapsed >= minMs) return { passed: true };

  const retryAfter = new Date(lastSentAt.getTime() + minMs);
  return {
    passed: false,
    failedGate: 'per_nick_throttle',
    detail: `Nick gửi gần đây quá (${actionType}), throttle còn ${Math.ceil((minMs - elapsed) / 60000)} phút`,
    retryAfter,
  };
}

// Daily cap gate — caller passes count of tasks executed today by this nick
// for this action category. Cap value from ZaloAccount per-nick override.
export function checkDailyCap(
  actionType: BlockActionType,
  executedTodayCount: number,
  capValue: number,
): GateResult {
  if (capValue <= 0) return { passed: true }; // 0 = unlimited (admin convention)
  if (executedTodayCount < capValue) return { passed: true };

  // Retry at midnight (cap resets per day)
  const retryAfter = new Date();
  retryAfter.setDate(retryAfter.getDate() + 1);
  retryAfter.setHours(0, 5, 0, 0); // 5 min after midnight for safety
  return {
    passed: false,
    failedGate: actionType === 'request_friend' ? 'cap_friend_add' : 'cap_message',
    detail: `Nick hit daily cap ${capValue} (${executedTodayCount} đã gửi)`,
    retryAfter,
  };
}

// Stop-on-accept gate — if rule on and Contact has any accepted nick, skip.
// Caller passes acceptedNicksCount from Contact row.
export function checkStopOnAccept(
  rules: SequenceRuntimeRules,
  acceptedNicksCount: number,
): GateResult {
  if (!rules.stopOnAccept) return { passed: true };
  if (acceptedNicksCount === 0) return { passed: true };
  return {
    passed: false,
    failedGate: 'stop_on_accept',
    detail: `KH đã accept ${acceptedNicksCount} nick khác, dừng theo rule`,
  };
}

// Cross-nick recency gate — if ANY other nick had recent (within recencyDays)
// activity with this contact, skip. Caller passes the latest activity date
// across all other nicks (or null if none).
export function checkCrossNickRecency(
  now: Date,
  rules: SequenceRuntimeRules,
  latestOtherNickActivity: Date | null,
): GateResult {
  const days = rules.crossNickRecencyDays;
  if (!days || days <= 0) return { passed: true };
  if (!latestOtherNickActivity) return { passed: true };

  const cutoffMs = days * 24 * 60 * 60 * 1000;
  const elapsed = now.getTime() - latestOtherNickActivity.getTime();
  if (elapsed >= cutoffMs) return { passed: true };

  // Retry after recency window expires
  const retryAfter = new Date(latestOtherNickActivity.getTime() + cutoffMs);
  return {
    passed: false,
    failedGate: 'cross_nick_recency',
    detail: `Nick khác đã active với KH trong ${Math.ceil((cutoffMs - elapsed) / (24 * 60 * 60 * 1000))} ngày qua`,
    retryAfter,
  };
}

// Block-archived gate — block was archived after task was enqueued. Snapshot
// still works (task carries content) but business rule: don't send if block
// was deliberately archived.
export function checkBlockArchived(
  blockArchivedAt: Date | null,
): GateResult {
  if (!blockArchivedAt) return { passed: true };
  return {
    passed: false,
    failedGate: 'block_archived',
    detail: 'Block đã bị archive sau khi task được enqueue',
  };
}

// Rule-disabled gate — Sequence / Trigger / Broadcast was disabled.
export function checkRuleEnabled(enabled: boolean): GateResult {
  if (enabled) return { passed: true };
  return {
    passed: false,
    failedGate: 'rule_disabled',
    detail: 'Sequence/Trigger đã bị disable',
  };
}
