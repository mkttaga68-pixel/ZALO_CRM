/**
 * crm-tag-nick-policy.test.ts — chính sách chọn nick + gate consent (2026-10-25).
 *
 * Điểm cốt lõi phải giữ đúng:
 *  - mode 'fixed': nick chỉ định không khả dụng thì BỎ QUA, TUYỆT ĐỐI không tự
 *    đổi sang nick khác (đổi nick = KH nhận tin từ người lạ).
 *  - Nick phải nằm trong quyền (chat|admin) của người cấu hình trigger.
 *  - Không cấu hình nickPolicy → giữ nguyên hành vi cũ, không lọc gì.
 *  - KH opt-out thì gate consent chặn ở mọi hành động gửi ra ngoài.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const zaloAccountFindFirstMock = vi.fn();
const zaloAccountFindManyMock = vi.fn();
const friendFindFirstMock = vi.fn();
const friendFindManyMock = vi.fn();
const accessFindUniqueMock = vi.fn();
const attemptFindManyMock = vi.fn();
const taskCountMock = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    zaloAccount: { findFirst: zaloAccountFindFirstMock, findMany: zaloAccountFindManyMock },
    friend: { findFirst: friendFindFirstMock, findMany: friendFindManyMock },
    zaloAccountAccess: { findUnique: accessFindUniqueMock },
    friendshipAttempt: { findMany: attemptFindManyMock },
    automationTask: { count: taskCountMock },
  },
}));

const { pickNickForTask } = await import('../src/modules/automation/engine/nick-selector.js');
const { checkConsent } = await import('../src/modules/automation/engine/gate-evaluator.js');

const base = { orgId: 'org-1', contactId: 'kh-1', actionType: 'send_message' as const };

beforeEach(() => {
  vi.clearAllMocks();
  zaloAccountFindFirstMock.mockResolvedValue({ id: 'nick-1', status: 'connected' });
  friendFindFirstMock.mockResolvedValue({ id: 'fr-1' });
  accessFindUniqueMock.mockResolvedValue({ permission: 'chat' });
  friendFindManyMock.mockResolvedValue([]);
  zaloAccountFindManyMock.mockResolvedValue([]);
  attemptFindManyMock.mockResolvedValue([]);
  taskCountMock.mockResolvedValue(0);
});

describe('TC8 — nick Zalo offline (chính sách cố định)', () => {
  it('nick cố định offline → bỏ qua, KHÔNG đổi nick khác', async () => {
    zaloAccountFindFirstMock.mockResolvedValue({ id: 'nick-1', status: 'disconnected' });

    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-1' },
    });

    expect(r).toEqual({ nickId: null, skipReason: 'fixed_nick_not_connected' });
    // Không được đi tìm nick nào khác.
    expect(friendFindManyMock).not.toHaveBeenCalled();
    expect(zaloAccountFindManyMock).not.toHaveBeenCalled();
  });

  it('nick cố định không thuộc org → bỏ qua', async () => {
    zaloAccountFindFirstMock.mockResolvedValue(null);

    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-cua-org-khac' },
    });

    expect(r).toEqual({ nickId: null, skipReason: 'fixed_nick_not_found' });
  });

  it('mode fixed nhưng chưa chọn nick → bỏ qua, không tự chọn hộ', async () => {
    const r = await pickNickForTask({ ...base, nickPolicy: { mode: 'fixed' } });
    expect(r).toEqual({ nickId: null, skipReason: 'fixed_nick_not_found' });
    expect(zaloAccountFindFirstMock).not.toHaveBeenCalled();
  });

  it('nick cố định khả dụng + là bạn với KH → chọn đúng nick đó', async () => {
    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-1' },
    });
    expect(r).toEqual({ nickId: 'nick-1', reason: 'fixed' });
  });
});

describe('Quyền sử dụng nick gửi', () => {
  it('người cấu hình không có quyền trên nick cố định → bỏ qua', async () => {
    accessFindUniqueMock.mockResolvedValue({ permission: 'read' });

    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-1', onBehalfOfUserId: 'nv-1' },
    });

    expect(r).toEqual({ nickId: null, skipReason: 'fixed_nick_no_permission' });
  });

  it('không có row ZaloAccountAccess → coi như không có quyền', async () => {
    accessFindUniqueMock.mockResolvedValue(null);

    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-1', onBehalfOfUserId: 'nv-1' },
    });

    expect(r).toEqual({ nickId: null, skipReason: 'fixed_nick_no_permission' });
  });

  it("permission 'admin' được phép gửi", async () => {
    accessFindUniqueMock.mockResolvedValue({ permission: 'admin' });

    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-1', onBehalfOfUserId: 'nv-1' },
    });

    expect(r).toEqual({ nickId: 'nick-1', reason: 'fixed' });
  });

  it('mode auto + onBehalfOfUserId: lọc nick ngoài quyền, không trả nick lậu', async () => {
    friendFindManyMock.mockResolvedValue([
      { zaloAccountId: 'nick-khong-quyen', friendshipStatus: 'accepted', lastInboundAt: null },
    ]);
    accessFindUniqueMock.mockResolvedValue({ permission: 'read' });

    const r = await pickNickForTask({ ...base, nickPolicy: { mode: 'auto', onBehalfOfUserId: 'nv-1' } });

    expect(r).toBeNull();
  });
});

describe('TC4 — khách xuất hiện trên nhiều nick Zalo', () => {
  it('mode fixed: chỉ gửi từ nick chỉ định, không chọn nick khác dù cũng là bạn', async () => {
    // nick-2 cũng là bạn với KH, nhưng chính sách chốt nick-1.
    friendFindManyMock.mockResolvedValue([
      { zaloAccountId: 'nick-2', friendshipStatus: 'accepted', lastInboundAt: new Date() },
    ]);

    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-1' },
    });

    expect(r).toEqual({ nickId: 'nick-1', reason: 'fixed' });
    expect(friendFindManyMock).not.toHaveBeenCalled();
  });

  it('nick cố định chưa là bạn với KH → bỏ qua, không nhảy sang nick đang là bạn', async () => {
    friendFindFirstMock.mockResolvedValue(null);

    const r = await pickNickForTask({
      ...base,
      nickPolicy: { mode: 'fixed', fixedNickId: 'nick-1' },
    });

    expect(r).toEqual({ nickId: null, skipReason: 'fixed_nick_not_friend' });
  });

  it('mode auto (hành vi cũ): ưu tiên nick đã accepted', async () => {
    friendFindManyMock.mockResolvedValue([
      { zaloAccountId: 'nick-pending', friendshipStatus: 'pending_sent', lastInboundAt: new Date() },
      { zaloAccountId: 'nick-accepted', friendshipStatus: 'accepted', lastInboundAt: null },
    ]);

    const r = await pickNickForTask({ ...base });

    expect(r).toEqual({ nickId: 'nick-accepted', reason: 'existing_friend' });
  });

  it('không cấu hình nickPolicy → không gọi check quyền (giữ hành vi cũ)', async () => {
    friendFindManyMock.mockResolvedValue([
      { zaloAccountId: 'nick-1', friendshipStatus: 'accepted', lastInboundAt: null },
    ]);

    await pickNickForTask({ ...base });

    expect(accessFindUniqueMock).not.toHaveBeenCalled();
  });
});

describe('TC9 — gate consent ở tầng gửi tin', () => {
  it('revoked → chặn gửi tin', () => {
    const r = checkConsent('send_message', 'revoked');
    expect(r.passed).toBe(false);
    expect(r.failedGate).toBe('consent_revoked');
  });

  it('revoked → chặn cả mời kết bạn', () => {
    expect(checkConsent('request_friend', 'revoked').passed).toBe(false);
  });

  it("implicit / granted / null → cho qua (KH cũ mặc định 'implicit')", () => {
    expect(checkConsent('send_message', 'implicit').passed).toBe(true);
    expect(checkConsent('send_message', 'granted').passed).toBe(true);
    expect(checkConsent('send_message', null).passed).toBe(true);
  });

  it('update_status là ghi DB nội bộ → consent không liên quan', () => {
    expect(checkConsent('update_status', 'revoked').passed).toBe(true);
  });
});
