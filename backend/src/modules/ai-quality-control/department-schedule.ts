import { Prisma } from '@prisma/client';
import { QcError } from './contracts.js';

/**
 * Lịch hoạt động (timeset) của AI quét liên tục theo phòng ban.
 * - Công tắc AI phòng ban vẫn là công tắc chính; lịch chỉ thu hẹp thời gian AI hoạt động.
 * - Ngày dùng quy ước getDay()/PostgreSQL dow: 0 = Chủ nhật … 6 = Thứ bảy.
 * - Khung qua đêm (start > end) thuộc về ngày bắt đầu: T6 22:00–02:00 gồm cả 00:00–02:00 sáng T7.
 * - Múi giờ cố định Asia/Ho_Chi_Minh (GMT+7, không có giờ mùa hè).
 */
export const SCHEDULE_TIMEZONE = 'Asia/Ho_Chi_Minh';
const OFFSET_MS = 7 * 3600_000;
export const MAX_SCHEDULE_WINDOWS = 4;

export interface ScheduleWindow { start: string; end: string }
export interface DepartmentSchedule { enabled: boolean; days: number[]; windows: ScheduleWindow[]; timezone: typeof SCHEDULE_TIMEZONE }

export const defaultSchedule = (): DepartmentSchedule => ({ enabled: false, days: [1, 2, 3, 4, 5], windows: [{ start: '08:00', end: '17:30' }], timezone: SCHEDULE_TIMEZONE });

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));

export function validateSchedule(body: unknown): DepartmentSchedule {
  const b = body as Partial<DepartmentSchedule> | null;
  if (!b || typeof b !== 'object' || typeof b.enabled !== 'boolean' || !Array.isArray(b.days) || !Array.isArray(b.windows)) throw new QcError('SCHEDULE_INVALID');
  const days = [...new Set(b.days)];
  if (days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new QcError('SCHEDULE_INVALID');
  if (b.windows.length > MAX_SCHEDULE_WINDOWS) throw new QcError('SCHEDULE_INVALID');
  const windows = b.windows.map(w => {
    if (!w || typeof w.start !== 'string' || typeof w.end !== 'string' || !HHMM.test(w.start) || !HHMM.test(w.end) || w.start === w.end) throw new QcError('SCHEDULE_INVALID');
    return { start: w.start, end: w.end };
  });
  if (b.enabled && (!days.length || !windows.length)) throw new QcError('SCHEDULE_EMPTY');
  return { enabled: b.enabled, days: days.sort(), windows, timezone: SCHEDULE_TIMEZONE };
}

/** Lịch đang mở tại thời điểm `at`? Lịch tắt nghĩa là chạy cả ngày (khi công tắc chính bật). */
export function scheduleActiveAt(s: DepartmentSchedule | null | undefined, at: Date): boolean {
  if (!s?.enabled) return true;
  const local = new Date(at.getTime() + OFFSET_MS);
  const day = local.getUTCDay(), prev = (day + 6) % 7, t = local.getUTCHours() * 60 + local.getUTCMinutes();
  return s.windows.some(w => {
    const a = minutes(w.start), b = minutes(w.end);
    return a < b ? s.days.includes(day) && t >= a && t < b : (s.days.includes(day) && t >= a) || (s.days.includes(prev) && t < b);
  });
}

/** Thời điểm kế tiếp trạng thái bật/tắt theo lịch đổi (trong 8 ngày tới), hoặc null. */
export function nextScheduleChange(s: DepartmentSchedule | null | undefined, now: Date): Date | null {
  if (!s?.enabled) return null;
  const current = scheduleActiveAt(s, now);
  const localMidnight = Math.floor((now.getTime() + OFFSET_MS) / 86400_000) * 86400_000 - OFFSET_MS;
  const candidates: number[] = [];
  for (let d = 0; d <= 8; d++) for (const w of s.windows) for (const m of [minutes(w.start), minutes(w.end)]) candidates.push(localMidnight + d * 86400_000 + m * 60_000);
  for (const c of [...new Set(candidates)].sort((x, y) => x - y)) if (c > now.getTime() && scheduleActiveAt(s, new Date(c)) !== current) return new Date(c);
  return null;
}

/**
 * Điều kiện SQL tương đương scheduleActiveAt cho cột timestamp-without-time-zone lưu UTC.
 * `alias` là bảng lịch (LEFT JOIN, có thể NULL), `column` là cột thời điểm tin nhắn.
 */
export function scheduleSqlPredicate(alias: string, column: string): Prisma.Sql {
  const local = `((${column} AT TIME ZONE 'UTC') AT TIME ZONE '${SCHEDULE_TIMEZONE}')`;
  return Prisma.raw(`(${alias}.enabled IS NOT TRUE OR EXISTS (SELECT 1 FROM jsonb_array_elements(${alias}.windows) w WHERE CASE WHEN (w->>'start')::time < (w->>'end')::time
      THEN ${alias}.days @> to_jsonb(extract(dow FROM ${local})::int) AND ${local}::time >= (w->>'start')::time AND ${local}::time < (w->>'end')::time
      ELSE (${alias}.days @> to_jsonb(extract(dow FROM ${local})::int) AND ${local}::time >= (w->>'start')::time)
        OR (${alias}.days @> to_jsonb(extract(dow FROM ${local} - INTERVAL '1 day')::int) AND ${local}::time < (w->>'end')::time) END))`);
}
