import { describe, expect, it } from 'vitest';
import { nextScheduleChange, scheduleActiveAt, validateSchedule, type DepartmentSchedule } from '../src/modules/ai-quality-control/department-schedule.js';

// Giờ Việt Nam = UTC+7. 2026-11-09 là Thứ 2.
const vn = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
const office: DepartmentSchedule = { enabled: true, days: [1, 2, 3, 4, 5], windows: [{ start: '08:00', end: '12:00' }, { start: '13:30', end: '17:30' }], timezone: 'Asia/Ho_Chi_Minh' };
const night: DepartmentSchedule = { enabled: true, days: [5], windows: [{ start: '22:00', end: '02:00' }], timezone: 'Asia/Ho_Chi_Minh' };

describe('department AI timeset schedule', () => {
  it('no schedule (or disabled) means always active', () => {
    expect(scheduleActiveAt(null, vn('2026-11-09', '03:00'))).toBe(true);
    expect(scheduleActiveAt({ ...office, enabled: false }, vn('2026-11-15', '03:00'))).toBe(true);
  });
  it('follows office windows in Vietnam time, end exclusive', () => {
    expect(scheduleActiveAt(office, vn('2026-11-09', '07:59'))).toBe(false);
    expect(scheduleActiveAt(office, vn('2026-11-09', '08:00'))).toBe(true);
    expect(scheduleActiveAt(office, vn('2026-11-09', '12:00'))).toBe(false); // nghỉ trưa
    expect(scheduleActiveAt(office, vn('2026-11-09', '13:30'))).toBe(true);
    expect(scheduleActiveAt(office, vn('2026-11-09', '17:30'))).toBe(false);
    expect(scheduleActiveAt(office, vn('2026-11-14', '09:00'))).toBe(false); // Thứ 7
    expect(scheduleActiveAt(office, vn('2026-11-15', '09:00'))).toBe(false); // Chủ nhật
  });
  it('overnight window belongs to its start day', () => {
    expect(scheduleActiveAt(night, vn('2026-11-13', '23:00'))).toBe(true); // T6 23:00
    expect(scheduleActiveAt(night, vn('2026-11-14', '01:59'))).toBe(true); // sáng T7, thuộc ca T6
    expect(scheduleActiveAt(night, vn('2026-11-14', '02:00'))).toBe(false);
    expect(scheduleActiveAt(night, vn('2026-11-14', '23:00'))).toBe(false); // T7 không chọn
    expect(scheduleActiveAt(night, vn('2026-11-13', '01:00'))).toBe(false); // sáng T6 thuộc ca T5
  });
  it('computes the next automatic on/off moment', () => {
    expect(nextScheduleChange(office, vn('2026-11-09', '10:00'))).toEqual(vn('2026-11-09', '12:00'));
    expect(nextScheduleChange(office, vn('2026-11-09', '12:30'))).toEqual(vn('2026-11-09', '13:30'));
    expect(nextScheduleChange(office, vn('2026-11-13', '18:00'))).toEqual(vn('2026-11-16', '08:00')); // T6 tối → T2 sáng
    expect(nextScheduleChange(night, vn('2026-11-13', '23:00'))).toEqual(vn('2026-11-14', '02:00'));
    expect(nextScheduleChange({ ...office, enabled: false }, vn('2026-11-09', '10:00'))).toBeNull();
  });
  it('validates input strictly', () => {
    expect(validateSchedule({ enabled: true, days: [5, 1, 1], windows: [{ start: '08:00', end: '17:30' }] })).toEqual({ enabled: true, days: [1, 5], windows: [{ start: '08:00', end: '17:30' }], timezone: 'Asia/Ho_Chi_Minh' });
    expect(validateSchedule({ enabled: false, days: [], windows: [] }).enabled).toBe(false);
    for (const bad of [null, { enabled: true, days: [7], windows: [{ start: '08:00', end: '09:00' }] }, { enabled: true, days: [1], windows: [{ start: '8:00', end: '09:00' }] },
      { enabled: true, days: [1], windows: [{ start: '09:00', end: '09:00' }] }, { enabled: true, days: [1], windows: Array(5).fill({ start: '08:00', end: '09:00' }) }, { enabled: 'yes', days: [1], windows: [] }])
      expect(() => validateSchedule(bad)).toThrow('SCHEDULE_INVALID');
    expect(() => validateSchedule({ enabled: true, days: [], windows: [{ start: '08:00', end: '09:00' }] })).toThrow('SCHEDULE_EMPTY');
    expect(() => validateSchedule({ enabled: true, days: [1], windows: [] })).toThrow('SCHEDULE_EMPTY');
  });
});
