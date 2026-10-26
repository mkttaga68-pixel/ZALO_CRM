// Phase 7 — AutomationSequence types & PURE validators.
//
// IMPORTANT: This file must NOT import prisma so it can be unit-tested in
// isolation without DATABASE_URL. DB-reaching helpers live in ./block-refs.ts.
//
// Sequence = ordered composition of Blocks with explicit delays between steps.
// Steps array shape:
//   [{ stepId, blockId, delayMinutes, exitCondition? }, ...]
//
// delayMinutes is the wait BEFORE this step executes, relative to the previous
// step's completion. delayMinutes=0 for step 1 means "run immediately at enroll".

export interface SequenceStep {
  stepId: string;            // stable identifier (UI uses for drag-drop, react keys)
  blockId: string;           // FK to Block.id
  delayMinutes: number;      // wait BEFORE this step executes (≥ 0)
  exitCondition?: string;    // optional gate name, future use
}

export interface SequenceRuntimeRules {
  allowedHourRange?: [number, number];
  randomDelayPerSend?: { min: number; max: number };
  /** Seconds-based delay; takes precedence over the legacy minute field. */
  randomDelayPerSendSeconds?: { min: number; max: number };
  perNickThrottle?: boolean;
  crossNickRecencyDays?: number;
  stopOnAccept?: boolean;
  /**
   * Chính sách chọn nick gửi (2026-10-25). Không set → engine tự chọn trong pool
   * (hành vi cũ). Shape khớp NickPolicy ở engine/nick-selector.ts — khai báo lại
   * ở đây để file này không phải import engine (giữ nguyên tắc "types không
   * import prisma" ghi ở đầu file).
   *
   * mode 'fixed' + fixedNickId: chỉ gửi từ đúng nick đó; nick không khả dụng thì
   * BỎ QUA, không tự chuyển nick khác.
   * onBehalfOfUserId: nick phải nằm trong quyền (chat|admin) của user này.
   */
  nickPolicy?: {
    mode?: 'auto' | 'fixed';
    fixedNickId?: string | null;
    onBehalfOfUserId?: string | null;
  };
}

// Default runtime rules baked from memory rules:
//   - project_zalocrm_automation_delay_rules: 15-45 phút, hour 6-22
//   - project_zalocrm_per_nick_throttle_gate: BẬT
//   - project_zalocrm_cross_nick_friendship_recency: configurable per campaign
export const DEFAULT_RUNTIME_RULES: SequenceRuntimeRules = {
  allowedHourRange: [6, 22],
  randomDelayPerSend: { min: 15, max: 45 },
  perNickThrottle: true,
  crossNickRecencyDays: 30,
  stopOnAccept: true,
};

// ── Validators (pure — no DB) ──────────────────────────────────────────────

export function validateSteps(
  steps: unknown,
): { ok: true; steps: SequenceStep[] } | { ok: false; error: string } {
  if (!Array.isArray(steps)) return { ok: false, error: 'steps phải là mảng' };
  if (steps.length === 0) return { ok: false, error: 'sequence cần ít nhất 1 step' };

  const seenStepIds = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (typeof s !== 'object' || s === null) {
      return { ok: false, error: `step #${i + 1} phải là object` };
    }
    const step = s as Record<string, unknown>;
    if (typeof step.stepId !== 'string' || !step.stepId) {
      return { ok: false, error: `step #${i + 1} thiếu stepId` };
    }
    if (seenStepIds.has(step.stepId)) {
      return { ok: false, error: `stepId '${step.stepId}' bị trùng` };
    }
    seenStepIds.add(step.stepId);

    if (typeof step.blockId !== 'string' || !step.blockId) {
      return { ok: false, error: `step '${step.stepId}' thiếu blockId` };
    }
    if (typeof step.delayMinutes !== 'number' || step.delayMinutes < 0) {
      return { ok: false, error: `step '${step.stepId}' delayMinutes phải là số ≥ 0` };
    }
    // Cap delay at 60 days = 86400 minutes (defensive against typos like delayDays in minutes field)
    if (step.delayMinutes > 86400) {
      return { ok: false, error: `step '${step.stepId}' delayMinutes > 60 ngày, kiểm tra lại` };
    }
  }
  return { ok: true, steps: steps as SequenceStep[] };
}

export function validateRuntimeRules(
  rules: unknown,
): { ok: true; rules: SequenceRuntimeRules } | { ok: false; error: string } {
  if (rules === null || rules === undefined) return { ok: true, rules: {} };
  if (typeof rules !== 'object') return { ok: false, error: 'runtimeRules phải là object' };
  const r = rules as Record<string, unknown>;

  if (r.allowedHourRange !== undefined) {
    if (!Array.isArray(r.allowedHourRange) || r.allowedHourRange.length !== 2) {
      return { ok: false, error: 'allowedHourRange phải là [start, end]' };
    }
    const [start, end] = r.allowedHourRange as unknown[];
    if (typeof start !== 'number' || typeof end !== 'number'
        || start < 0 || start > 23 || end < 0 || end > 23 || start > end) {
      return { ok: false, error: 'allowedHourRange giá trị 0-23, start ≤ end' };
    }
  }

  if (r.randomDelayPerSend !== undefined) {
    if (typeof r.randomDelayPerSend !== 'object' || r.randomDelayPerSend === null) {
      return { ok: false, error: 'randomDelayPerSend phải là { min, max }' };
    }
    const d = r.randomDelayPerSend as Record<string, unknown>;
    if (typeof d.min !== 'number' || typeof d.max !== 'number' || d.min < 0 || d.max < d.min) {
      return { ok: false, error: 'randomDelayPerSend.min/max phải là số, min ≤ max' };
    }
  }

  if (r.randomDelayPerSendSeconds !== undefined) {
    if (typeof r.randomDelayPerSendSeconds !== 'object' || r.randomDelayPerSendSeconds === null) {
      return { ok: false, error: 'randomDelayPerSendSeconds phải là { min, max }' };
    }
    const d = r.randomDelayPerSendSeconds as Record<string, unknown>;
    if (typeof d.min !== 'number' || typeof d.max !== 'number'
        || d.min < 0 || d.max < d.min || d.max > 3600) {
      return { ok: false, error: 'randomDelayPerSendSeconds phải thỏa 0 ≤ min ≤ max ≤ 3600' };
    }
  }

  if (r.perNickThrottle !== undefined && typeof r.perNickThrottle !== 'boolean') {
    return { ok: false, error: 'perNickThrottle phải là boolean' };
  }
  if (r.crossNickRecencyDays !== undefined) {
    if (typeof r.crossNickRecencyDays !== 'number' || r.crossNickRecencyDays < 0) {
      return { ok: false, error: 'crossNickRecencyDays phải là số ≥ 0' };
    }
  }
  if (r.stopOnAccept !== undefined && typeof r.stopOnAccept !== 'boolean') {
    return { ok: false, error: 'stopOnAccept phải là boolean' };
  }

  return { ok: true, rules: r as SequenceRuntimeRules };
}

export function randomDelayRangeMs(rules: SequenceRuntimeRules): { min: number; max: number } {
  const seconds = rules.randomDelayPerSendSeconds;
  if (seconds) return { min: seconds.min * 1000, max: seconds.max * 1000 };
  const minutes = rules.randomDelayPerSend;
  return { min: (minutes?.min ?? 0) * 60_000, max: (minutes?.max ?? 0) * 60_000 };
}
