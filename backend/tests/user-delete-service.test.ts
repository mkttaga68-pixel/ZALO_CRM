/**
 * user-delete-service.test.ts — Xoá vĩnh viễn nhân viên + bàn giao dữ liệu.
 *
 * Trọng tâm là các chốt an toàn, vì thao tác này không hoàn tác được:
 *  - Không xoá chính mình, không xoá chủ tổ chức cuối cùng.
 *  - Còn nick Zalo / ghi chú / kịch bản → BẮT BUỘC bàn giao (khoá ngoại RESTRICT,
 *    không chuyển chủ thì lệnh xoá fail giữa chừng).
 *  - Người nhận bàn giao phải cùng org và còn hoạt động (fail-closed).
 *  - KHÔNG xoá KH / hội thoại — dữ liệu khách hàng thuộc tổ chức, không thuộc cá nhân.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock: any = {
  user: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), delete: vi.fn() },
  zaloAccount: { count: vi.fn(), updateMany: vi.fn() },
  note: { count: vi.fn(), updateMany: vi.fn() },
  block: { count: vi.fn(), updateMany: vi.fn() },
  blockFolder: { count: vi.fn(), updateMany: vi.fn() },
  automationSequence: { count: vi.fn(), updateMany: vi.fn() },
  automationTrigger: { count: vi.fn(), updateMany: vi.fn() },
  automationBroadcast: { count: vi.fn(), updateMany: vi.fn() },
  contact: { count: vi.fn() },
  appointment: { count: vi.fn() },
  $transaction: vi.fn(),
};

const logActivityMock = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/activity/activity-logger.js', () => ({ logActivity: logActivityMock }));

const { buildDeletionPreview, deleteUserPermanently } = await import(
  '../src/modules/auth/user-delete-service.js'
);

const ORG = 'org-1';
const ACTOR = { id: 'owner-1', email: 'owner@x' };
const TARGET = 'u-target';

/** Đặt số lượng bản ghi chặn xoá. Mặc định 0 = không cần bàn giao. */
function setBlockers(over: Partial<Record<string, number>> = {}) {
  prismaMock.zaloAccount.count.mockResolvedValue(over.zaloAccounts ?? 0);
  prismaMock.note.count.mockResolvedValue(over.notes ?? 0);
  prismaMock.block.count.mockResolvedValue(over.blocks ?? 0);
  prismaMock.blockFolder.count.mockResolvedValue(over.blockFolders ?? 0);
  prismaMock.automationSequence.count.mockResolvedValue(over.sequences ?? 0);
  prismaMock.automationTrigger.count.mockResolvedValue(over.triggers ?? 0);
  prismaMock.automationBroadcast.count.mockResolvedValue(over.broadcasts ?? 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(prismaMock)) {
    if (typeof model === 'object') for (const fn of Object.values(model as any)) (fn as any).mockReset?.();
  }
  prismaMock.$transaction.mockReset();
  logActivityMock.mockReset();

  setBlockers();
  prismaMock.user.findFirst.mockResolvedValue({
    id: TARGET, fullName: 'Nhân Viên', email: 'nv@x', role: 'member', isActive: true,
  });
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.contact.count.mockResolvedValue(0);
  prismaMock.appointment.count.mockResolvedValue(0);
  // $transaction nhận callback → chạy thẳng với chính prismaMock làm tx
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  for (const m of ['zaloAccount', 'note', 'block', 'blockFolder', 'automationSequence', 'automationTrigger', 'automationBroadcast']) {
    prismaMock[m].updateMany.mockResolvedValue({ count: 0 });
  }
  prismaMock.user.delete.mockResolvedValue({ id: TARGET });
});

describe('buildDeletionPreview', () => {
  it('gom đủ thứ phải bàn giao + ứng viên nhận', async () => {
    setBlockers({ zaloAccounts: 2, notes: 5, sequences: 1 });
    prismaMock.contact.count.mockResolvedValue(120);
    prismaMock.appointment.count.mockResolvedValue(3);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u-2', fullName: 'Người Nhận', email: 'nhan@x', role: 'member' },
    ]);

    const p = await buildDeletionPreview(ORG, TARGET);

    expect(p!.blockerTotal).toBe(8);
    expect(p!.blockers.zaloAccounts).toBe(2);
    expect(p!.unlinked.assignedContacts).toBe(120);
    expect(p!.transferCandidates).toHaveLength(1);
    // Ứng viên phải còn hoạt động và khác chính người bị xoá
    const where = prismaMock.user.findMany.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.id).toEqual({ not: TARGET });
  });

  it('trả null khi user không thuộc org', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    expect(await buildDeletionPreview(ORG, 'nguoi-la')).toBeNull();
  });
});

describe('deleteUserPermanently — chốt an toàn', () => {
  it('không cho xoá chính mình', async () => {
    const r = await deleteUserPermanently({ orgId: ORG, userId: ACTOR.id, actor: ACTOR });
    expect(r).toEqual({ ok: false, error: 'self' });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('không cho xoá chủ tổ chức cuối cùng', async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: TARGET, fullName: 'Chủ', email: 'chu@x', role: 'owner',
    });
    prismaMock.user.count.mockResolvedValue(1);

    const r = await deleteUserPermanently({ orgId: ORG, userId: TARGET, actor: ACTOR });
    expect(r).toEqual({ ok: false, error: 'last_owner' });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('còn nick Zalo mà không chọn người nhận → chặn, không xoá gì', async () => {
    setBlockers({ zaloAccounts: 1 });
    const r = await deleteUserPermanently({ orgId: ORG, userId: TARGET, actor: ACTOR });
    expect(r).toEqual({ ok: false, error: 'transfer_required' });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
    expect(prismaMock.zaloAccount.updateMany).not.toHaveBeenCalled();
  });

  it('người nhận không thuộc org / đã vô hiệu → chặn', async () => {
    setBlockers({ notes: 2 });
    prismaMock.user.findFirst
      .mockResolvedValueOnce({ id: TARGET, fullName: 'NV', email: 'nv@x', role: 'member' })
      .mockResolvedValueOnce(null); // tra người nhận → không thấy

    const r = await deleteUserPermanently({
      orgId: ORG, userId: TARGET, transferToUserId: 'nguoi-la', actor: ACTOR,
    });
    expect(r).toEqual({ ok: false, error: 'bad_transfer_target' });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('không cho bàn giao cho chính người sắp bị xoá', async () => {
    setBlockers({ notes: 1 });
    const r = await deleteUserPermanently({
      orgId: ORG, userId: TARGET, transferToUserId: TARGET, actor: ACTOR,
    });
    expect(r).toEqual({ ok: false, error: 'bad_transfer_target' });
  });
});

describe('deleteUserPermanently — bàn giao rồi xoá', () => {
  it('chuyển chủ nick Zalo, ghi chú, kịch bản sang người nhận rồi mới xoá', async () => {
    setBlockers({ zaloAccounts: 2, notes: 5, blocks: 1, sequences: 1, triggers: 1, broadcasts: 1 });
    prismaMock.user.findFirst
      .mockResolvedValueOnce({ id: TARGET, fullName: 'NV', email: 'nv@x', role: 'member' })
      .mockResolvedValueOnce({ id: 'u-2', fullName: 'Người Nhận', email: 'nhan@x' });

    const r = await deleteUserPermanently({
      orgId: ORG, userId: TARGET, transferToUserId: 'u-2', actor: ACTOR,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.transferredTo!.email).toBe('nhan@x');

    // Nick Zalo chỉ ĐỔI CHỦ — không gỡ kết nối, không xoá
    expect(prismaMock.zaloAccount.updateMany).toHaveBeenCalledWith({
      where: { orgId: ORG, ownerUserId: TARGET },
      data: { ownerUserId: 'u-2' },
    });
    expect(prismaMock.note.updateMany).toHaveBeenCalledWith({
      where: { orgId: ORG, authorUserId: TARGET },
      data: { authorUserId: 'u-2' },
    });
    for (const m of ['block', 'blockFolder', 'automationSequence', 'automationTrigger', 'automationBroadcast']) {
      expect(prismaMock[m].updateMany).toHaveBeenCalled();
    }
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: TARGET } });

    // Bàn giao phải xảy ra TRƯỚC khi xoá user
    const transfer = prismaMock.zaloAccount.updateMany.mock.invocationCallOrder[0];
    const del = prismaMock.user.delete.mock.invocationCallOrder[0];
    expect(transfer).toBeLessThan(del);
  });

  it('không có gì phải bàn giao → xoá thẳng, không đụng bảng nào khác', async () => {
    const r = await deleteUserPermanently({ orgId: ORG, userId: TARGET, actor: ACTOR });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.transferredTo).toBeNull();
    expect(prismaMock.zaloAccount.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.note.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: TARGET } });
  });

  it('bàn giao + xoá nằm trong CÙNG 1 transaction', async () => {
    setBlockers({ zaloAccounts: 1 });
    prismaMock.user.findFirst
      .mockResolvedValueOnce({ id: TARGET, fullName: 'NV', email: 'nv@x', role: 'member' })
      .mockResolvedValueOnce({ id: 'u-2', fullName: 'N', email: 'n@x' });

    await deleteUserPermanently({ orgId: ORG, userId: TARGET, transferToUserId: 'u-2', actor: ACTOR });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('ghi Activity Log để truy vết ai xoá ai', async () => {
    await deleteUserPermanently({ orgId: ORG, userId: TARGET, actor: ACTOR });
    const logged = logActivityMock.mock.calls[0][0];
    expect(logged.action).toBe('user_deleted_permanently');
    expect(logged.userId).toBe(ACTOR.id);
    expect(logged.details.deletedUser.email).toBe('nv@x');
  });
});
