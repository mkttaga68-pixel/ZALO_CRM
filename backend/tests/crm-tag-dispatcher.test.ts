/**
 * crm-tag-dispatcher.test.ts — outbox dispatcher cho `crm_tag_added` (2026-10-25).
 *
 * Điểm cốt lõi phải giữ đúng:
 *  - Claim atomic: chỉ 1 process dispatch được 1 event.
 *  - Chọn trigger bằng crmTagId + orgId (không dùng tên tag).
 *  - Trigger tắt / không khớp tag → skipped, KHÔNG gửi.
 *  - KH opt-out (consentStatus=revoked) → skipped, bất kể trigger bật.
 *  - Nhân viên mất quyền với KH giữa lúc gắn tag và lúc dispatch → skipped.
 *  - Tag gắn TRƯỚC khi trigger được tạo → skipped (không chạy tag lịch sử).
 *  - Luôn truyền ĐÚNG 1 contactId xuống materializer → không gửi lan sang KH khác.
 *  - Hết lượt retry mà vẫn lỗi → state 'unknown', KHÔNG tự gửi lại.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const eventUpdateManyMock = vi.fn();
const eventFindUniqueMock = vi.fn();
const eventUpdateMock = vi.fn();
const eventFindManyMock = vi.fn();
const contactFindFirstMock = vi.fn();
const triggerFindManyMock = vi.fn();
const materializeMock = vi.fn();
const checkPolicyMock = vi.fn();
const logActivityMock = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    crmTagEvent: {
      updateMany: eventUpdateManyMock,
      findUnique: eventFindUniqueMock,
      update: eventUpdateMock,
      findMany: eventFindManyMock,
    },
    contact: { findFirst: contactFindFirstMock },
    automationTrigger: { findMany: triggerFindManyMock },
  },
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/automation/engine/campaign-materializer.js', () => ({
  materializeFromEvent: materializeMock,
}));
vi.mock('../src/core/runtime-policy.js', () => ({ checkPolicy: checkPolicyMock }));
vi.mock('../src/modules/activity/activity-logger.js', () => ({ logActivity: logActivityMock }));

const { dispatchCrmTagEvent } = await import(
  '../src/modules/automation/engine/crm-tag-dispatcher.js'
);

const NOW = new Date('2026-10-25T10:00:00.000Z');
const TRIGGER_CREATED = new Date('2026-10-20T00:00:00.000Z');

function evt(over: Record<string, unknown> = {}) {
  return {
    id: 'ev-1', orgId: 'org-1', contactId: 'kh-1', crmTagId: 'tag-cskh-1',
    tagName: 'Chăm sóc KH ngày 1', actorUserId: 'nv-1', source: 'crm_manual',
    occurredAt: NOW, attemptCount: 1, result: null, ...over,
  };
}

function trig(over: Record<string, unknown> = {}) {
  return {
    id: 'tr-1', name: 'KH được gắn Tag CRM', eventFilter: { crmTagId: 'tag-cskh-1' },
    createdAt: TRIGGER_CREATED, sequence: { id: 'sq-1', name: 'CSKH - Ngày 1' }, ...over,
  };
}

/** Lấy state cuối cùng ghi vào event. */
function finalState(): string | undefined {
  const calls = eventUpdateMock.mock.calls;
  return calls.length ? calls[calls.length - 1][0].data.state : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  eventUpdateManyMock.mockResolvedValue({ count: 1 }); // claim thành công
  eventFindUniqueMock.mockResolvedValue(evt());
  eventUpdateMock.mockResolvedValue({});
  contactFindFirstMock.mockResolvedValue({
    id: 'kh-1', mergedInto: null, consentStatus: 'implicit', hiddenAt: null,
  });
  triggerFindManyMock.mockResolvedValue([trig()]);
  checkPolicyMock.mockResolvedValue(true);
  materializeMock.mockResolvedValue({
    campaignsCreated: 1, tasksEnqueued: 1, skipped: 0, reasons: [],
  });
});

describe('Đường thành công', () => {
  it('claim atomic pending→dispatching rồi enroll đúng 1 KH', async () => {
    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('done');
    expect(r.tasksEnqueued).toBe(1);
    // Claim phải có điều kiện state='pending' — nếu không, 2 worker cùng gửi.
    expect(eventUpdateManyMock.mock.calls[0][0].where).toMatchObject({
      id: 'ev-1', state: 'pending',
    });
    expect(eventUpdateManyMock.mock.calls[0][0].data.state).toBe('dispatching');

    // Event gửi xuống materializer phải mang ĐÚNG 1 contactId, không segmentHint.
    const sent = materializeMock.mock.calls[0][0];
    expect(sent.type).toBe('crm_tag_added');
    expect(sent.contactId).toBe('kh-1');
    expect(sent.segmentHint).toBeUndefined();
    expect(sent.payload).toMatchObject({ crmTagId: 'tag-cskh-1', eventId: 'ev-1' });
    expect(finalState()).toBe('done');
  });

  it('chọn trigger theo crmTagId + orgId, không theo tên tag', async () => {
    await dispatchCrmTagEvent('ev-1');
    expect(triggerFindManyMock.mock.calls[0][0].where).toMatchObject({
      orgId: 'org-1', eventType: 'crm_tag_added', enabled: true,
    });
  });

  it('theo mergedInto về KH canonical trước khi enroll', async () => {
    contactFindFirstMock
      .mockResolvedValueOnce({ id: 'kh-1', mergedInto: 'kh-goc', consentStatus: 'implicit', hiddenAt: null })
      .mockResolvedValueOnce({ id: 'kh-goc', mergedInto: null, consentStatus: 'implicit', hiddenAt: null });

    await dispatchCrmTagEvent('ev-1');

    expect(materializeMock.mock.calls[0][0].contactId).toBe('kh-goc');
  });

});

describe('TC5 — trigger tắt', () => {
  it('không có trigger nào đang bật cho tag này → skipped, không gọi materializer', async () => {
    triggerFindManyMock.mockResolvedValue([]);

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(r.reason).toContain('không có trigger');
    expect(materializeMock).not.toHaveBeenCalled();
    expect(finalState()).toBe('skipped');
  });

  it('trigger bật nhưng cấu hình tag khác → skipped', async () => {
    triggerFindManyMock.mockResolvedValue([trig({ eventFilter: { crmTagId: 'tag-khac' } })]);

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(materializeMock).not.toHaveBeenCalled();
  });

  it('trigger chưa chọn tag kích hoạt → skipped (không khớp mọi tag)', async () => {
    triggerFindManyMock.mockResolvedValue([trig({ eventFilter: null })]);

    expect((await dispatchCrmTagEvent('ev-1')).outcome).toBe('skipped');
    expect(materializeMock).not.toHaveBeenCalled();
  });
});

describe('TC6 — sequence tắt', () => {
  it('materializer không tạo task nào → skipped kèm lý do từ materializer', async () => {
    materializeMock.mockResolvedValue({
      campaignsCreated: 0, tasksEnqueued: 0, skipped: 1,
      reasons: ['trigger tr-1: sequence disabled'],
    });

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(r.reason).toContain('sequence disabled');
    expect(finalState()).toBe('skipped');
  });
});

describe('TC9 — khách opt-out', () => {
  it('consentStatus=revoked → skipped, KHÔNG gọi materializer dù trigger bật', async () => {
    contactFindFirstMock.mockResolvedValue({
      id: 'kh-1', mergedInto: null, consentStatus: 'revoked', hiddenAt: null,
    });

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(r.reason).toContain('opt-out');
    expect(materializeMock).not.toHaveBeenCalled();
  });

  it("consentStatus='implicit' (mặc định của KH cũ) KHÔNG bị chặn", async () => {
    expect((await dispatchCrmTagEvent('ev-1')).outcome).toBe('done');
  });
});

describe('TC7 — nhân viên thiếu quyền', () => {
  it('policy contact.view trả false → skipped', async () => {
    checkPolicyMock.mockResolvedValue(false);

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(r.reason).toContain('không còn quyền');
    expect(materializeMock).not.toHaveBeenCalled();
  });

  it('check quyền trên KH canonical, với đúng actor đã gắn tag', async () => {
    await dispatchCrmTagEvent('ev-1');
    expect(checkPolicyMock).toHaveBeenCalledWith('contact.view', expect.objectContaining({
      userId: 'nv-1', orgId: 'org-1', resourceId: 'kh-1',
    }));
  });
});

describe('TC14 — không chạy ngoài phạm vi / không chạy tag lịch sử', () => {
  it('tag gắn TRƯỚC khi trigger được tạo → skipped', async () => {
    // Event vẫn mới (không trúng gate 24h) nhưng trigger sinh ra SAU nó — đúng
    // tình huống xoá trigger rồi tạo lại: event cũ không được trigger mới nhặt.
    eventFindUniqueMock.mockResolvedValue(evt({ occurredAt: NOW }));
    triggerFindManyMock.mockResolvedValue([
      trig({ createdAt: new Date(NOW.getTime() + 60 * 60 * 1000) }),
    ]);

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(r.reason).toContain('trước khi trigger được tạo');
    expect(materializeMock).not.toHaveBeenCalled();
  });

  it('event cũ hơn 24h → skipped (không gửi tin chăm sóc trễ)', async () => {
    eventFindUniqueMock.mockResolvedValue(
      evt({ occurredAt: new Date(NOW.getTime() - 25 * 3600 * 1000) }),
    );

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(r.reason).toContain('24h');
  });

  it('nguồn khác crm_manual (import/đồng bộ/backfill) → skipped', async () => {
    eventFindUniqueMock.mockResolvedValue(evt({ source: 'import' }));

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('skipped');
    expect(materializeMock).not.toHaveBeenCalled();
  });

  it('KH không còn trong org → skipped', async () => {
    contactFindFirstMock.mockResolvedValue(null);
    expect((await dispatchCrmTagEvent('ev-1')).outcome).toBe('skipped');
  });
});

describe('TC11/TC12 — retry và kết quả không xác định', () => {
  it('claim thất bại (process khác giành được) → not_claimed, không làm gì', async () => {
    eventUpdateManyMock.mockResolvedValue({ count: 0 });

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('not_claimed');
    expect(materializeMock).not.toHaveBeenCalled();
    expect(eventUpdateMock).not.toHaveBeenCalled();
  });

  it('lỗi hạ tầng còn lượt thử → về pending để sweeper thử lại', async () => {
    eventFindUniqueMock.mockResolvedValue(evt({ attemptCount: 1 }));
    materializeMock.mockRejectedValue(new Error('DB timeout'));

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('failed');
    expect(finalState()).toBe('pending');
  });

  it('hết lượt thử → state unknown, KHÔNG tự gửi lại', async () => {
    eventFindUniqueMock.mockResolvedValue(evt({ attemptCount: 3 }));
    materializeMock.mockRejectedValue(new Error('Zalo timeout — không rõ đã gửi chưa'));

    const r = await dispatchCrmTagEvent('ev-1');

    expect(r.outcome).toBe('unknown');
    expect(finalState()).toBe('unknown');
    const data = eventUpdateMock.mock.calls[eventUpdateMock.mock.calls.length - 1][0].data;
    expect(data.lastError).toContain('Zalo timeout');
  });
});

describe('Timeline KH', () => {
  it('thành công → ghi crm_tag_sequence_enrolled kèm tên sequence + số task', async () => {
    await dispatchCrmTagEvent('ev-1');

    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'crm_tag_sequence_enrolled',
      entityType: 'contact',
      entityId: 'kh-1',
      userId: 'nv-1',
    }));
    expect(logActivityMock.mock.calls[0][0].details).toMatchObject({
      tag: 'Chăm sóc KH ngày 1', tasksEnqueued: 1, sequenceName: 'CSKH - Ngày 1',
    });
  });

  it('bỏ qua → ghi crm_tag_sequence_skipped kèm lý do', async () => {
    triggerFindManyMock.mockResolvedValue([]);
    await dispatchCrmTagEvent('ev-1');

    expect(logActivityMock.mock.calls[0][0].action).toBe('crm_tag_sequence_skipped');
    expect(logActivityMock.mock.calls[0][0].details.reason).toContain('không có trigger');
  });
});
