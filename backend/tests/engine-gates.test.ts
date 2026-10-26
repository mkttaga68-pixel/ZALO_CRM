// Phase 7 Engine — gate evaluator unit tests (pure, no DB).

import { describe, it, expect } from 'vitest';
import {
  checkHourRange,
  checkPerNickThrottle,
  checkDailyCap,
  checkStopOnAccept,
  checkCrossNickRecency,
  checkBlockArchived,
  checkRuleEnabled,
} from '../src/modules/automation/engine/gate-evaluator.js';

const at = (hour: number) => {
  const d = new Date(Date.UTC(2026, 4, 20, hour, 0, 0)); // deterministic UTC fixture
  return d;
};

describe('checkHourRange', () => {
  it('passes inside [6,22]', () => {
    expect(checkHourRange(at(6), { allowedHourRange: [6, 22] }).passed).toBe(true);
    expect(checkHourRange(at(14), { allowedHourRange: [6, 22] }).passed).toBe(true);
    expect(checkHourRange(at(22), { allowedHourRange: [6, 22] }).passed).toBe(true);
  });

  it('blocks before window, retryAfter is same day at start hour', () => {
    const r = checkHourRange(at(3), { allowedHourRange: [6, 22] });
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('hour_range');
    expect(r.retryAfter?.getUTCHours()).toBe(6);
    expect(r.retryAfter?.getUTCDate()).toBe(20);
  });

  it('blocks after window, retryAfter is next day at start hour', () => {
    const r = checkHourRange(at(23), { allowedHourRange: [6, 22] });
    expect(r.passed).toBe(false);
    expect(r.retryAfter?.getUTCHours()).toBe(6);
    expect(r.retryAfter?.getUTCDate()).toBe(21);
  });

  it('no rule → passes', () => {
    expect(checkHourRange(at(3), {}).passed).toBe(true);
  });

  it('uses organization timezone instead of the UTC container timezone', () => {
    const noonInVietnam = new Date('2026-10-26T05:06:00.000Z');
    const r = checkHourRange(noonInVietnam, { allowedHourRange: [8, 22] }, '+07:00');
    expect(r.passed).toBe(true);
  });

  it('reschedules before the window to 08:00 in organization timezone', () => {
    const sevenInVietnam = new Date('2026-10-26T00:15:00.000Z');
    const r = checkHourRange(sevenInVietnam, { allowedHourRange: [8, 22] }, '+07:00');
    expect(r.passed).toBe(false);
    expect(r.retryAfter?.toISOString()).toBe('2026-10-26T01:00:00.000Z');
  });

  it('reschedules after the window to next-day 08:00 in organization timezone', () => {
    const elevenPmInVietnam = new Date('2026-10-26T16:15:00.000Z');
    const r = checkHourRange(elevenPmInVietnam, { allowedHourRange: [8, 22] }, '+07:00');
    expect(r.passed).toBe(false);
    expect(r.retryAfter?.toISOString()).toBe('2026-10-27T01:00:00.000Z');
  });

  it('falls back to UTC for an invalid timezone without crashing the worker', () => {
    const fiveUtc = new Date('2026-10-26T05:06:00.000Z');
    const r = checkHourRange(fiveUtc, { allowedHourRange: [8, 22] }, 'invalid');
    expect(r.passed).toBe(false);
    expect(r.retryAfter?.toISOString()).toBe('2026-10-26T08:00:00.000Z');
  });
});

describe('checkPerNickThrottle', () => {
  const rules = { perNickThrottle: true, randomDelayPerSend: { min: 15, max: 45 } };

  it('passes when no prior send', () => {
    expect(checkPerNickThrottle(new Date(), 'request_friend', null, rules).passed).toBe(true);
  });

  it('passes when elapsed > min delay', () => {
    const now = new Date();
    const lastSent = new Date(now.getTime() - 20 * 60 * 1000); // 20 min ago
    expect(checkPerNickThrottle(now, 'send_message', lastSent, rules).passed).toBe(true);
  });

  it('blocks when elapsed < min delay', () => {
    const now = new Date();
    const lastSent = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    const r = checkPerNickThrottle(now, 'request_friend', lastSent, rules);
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('per_nick_throttle');
    expect(r.retryAfter).toBeDefined();
  });

  it('passes if throttle disabled in rules', () => {
    const now = new Date();
    const lastSent = new Date(now.getTime() - 1000);
    expect(checkPerNickThrottle(now, 'request_friend', lastSent, { perNickThrottle: false, randomDelayPerSend: { min: 15, max: 45 } }).passed).toBe(true);
  });

  it('uses seconds-based throttle when configured', () => {
    const now = new Date('2026-10-26T05:00:10.000Z');
    const lastSent = new Date('2026-10-26T05:00:00.000Z');
    const r = checkPerNickThrottle(now, 'send_message', lastSent, {
      perNickThrottle: true,
      randomDelayPerSend: { min: 15, max: 45 },
      randomDelayPerSendSeconds: { min: 30, max: 30 },
    });
    expect(r.passed).toBe(false);
    expect(r.retryAfter?.toISOString()).toBe('2026-10-26T05:00:30.000Z');
  });
});

describe('checkDailyCap', () => {
  it('passes when count under cap', () => {
    expect(checkDailyCap('request_friend', 5, 30).passed).toBe(true);
  });

  it('blocks at cap exactly', () => {
    const r = checkDailyCap('request_friend', 30, 30);
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('cap_friend_add');
    expect(r.retryAfter).toBeDefined();
  });

  it('blocks over cap', () => {
    const r = checkDailyCap('send_message', 350, 300);
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('cap_message');
  });

  it('treats cap=0 as unlimited', () => {
    expect(checkDailyCap('request_friend', 9999, 0).passed).toBe(true);
  });
});

describe('checkStopOnAccept', () => {
  it('passes when 0 accepted nicks', () => {
    expect(checkStopOnAccept({ stopOnAccept: true }, 0).passed).toBe(true);
  });

  it('blocks when ≥1 accepted nick', () => {
    const r = checkStopOnAccept({ stopOnAccept: true }, 2);
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('stop_on_accept');
  });

  it('passes if rule disabled', () => {
    expect(checkStopOnAccept({ stopOnAccept: false }, 5).passed).toBe(true);
  });
});

describe('checkCrossNickRecency', () => {
  it('passes when no other-nick activity', () => {
    expect(checkCrossNickRecency(new Date(), { crossNickRecencyDays: 30 }, null).passed).toBe(true);
  });

  it('passes when activity older than recency window', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000); // 31 days ago
    expect(checkCrossNickRecency(now, { crossNickRecencyDays: 30 }, old).passed).toBe(true);
  });

  it('blocks when activity within window', () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
    const r = checkCrossNickRecency(now, { crossNickRecencyDays: 30 }, recent);
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('cross_nick_recency');
    expect(r.retryAfter).toBeDefined();
  });

  it('passes if recency=0 (rule disabled)', () => {
    const recent = new Date();
    expect(checkCrossNickRecency(new Date(), { crossNickRecencyDays: 0 }, recent).passed).toBe(true);
  });
});

describe('checkBlockArchived', () => {
  it('passes when not archived', () => {
    expect(checkBlockArchived(null).passed).toBe(true);
  });

  it('blocks when archived', () => {
    const r = checkBlockArchived(new Date());
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('block_archived');
  });
});

describe('checkRuleEnabled', () => {
  it('passes when enabled', () => {
    expect(checkRuleEnabled(true).passed).toBe(true);
  });

  it('blocks when disabled', () => {
    const r = checkRuleEnabled(false);
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('rule_disabled');
  });
});
