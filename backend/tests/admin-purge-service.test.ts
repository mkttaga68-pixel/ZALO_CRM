/**
 * admin-purge-service.test.ts — Unit tests cho admin xoá dữ liệu KH đã đồng bộ.
 *
 * Tập trung vào các quyết định AN TOÀN, vì đây là thao tác không hoàn tác:
 *  - KH được nick của user KHÁC chăm → giữ Contact, chỉ cắt link nick
 *  - KH đã có dữ liệu người thật nhập → giữ Contact (keepCurated)
 *  - assignedUserId / statusId do hệ thống tự gán KHÔNG được tính là "người thật"
 *  - BẮT BUỘC set syncPaused, nếu không cron 15' hút lại toàn bộ
 *  - Không bao giờ gọi Zalo SDK (chỉ xoá khỏi hệ thống, không xoá kết bạn)
 *  - Fail-closed theo orgId + ownerUserId
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  user: { findFirst: vi.fn(), findMany: vi.fn() },
  zaloAccount: { findMany: vi.fn(), updateMany: vi.fn() },
  friend: { findMany: vi.fn(), deleteMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  contact: { findMany: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  customerListEntry: { findMany: vi.fn() },
  conversation: { findMany: vi.fn(), deleteMany: vi.fn() },
  message: { count: vi.fn(), deleteMany: vi.fn() },
  appointment: { count: vi.fn() },
  note: { count: vi.fn() },
  status: { findMany: vi.fn() },
  duplicateGroup: { deleteMany: vi.fn() },
  parentCandidate: { deleteMany: vi.fn() },
};

const logActivityMock = vi.fn();

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/activity/activity-logger.js', () => ({ logActivity: logActivityMock }));

const { buildPurgePlan, executePurge, resumeSync, listPurgeTargets } = await import(
  '../src/modules/contacts/admin-purge-service.js'
);

const ORG = 'org-1';
const USER = 'user-sale';
const NICK_A = 'za-a';
const NICK_B_OTHER_USER = 'za-other';

function setDefaults() {
  prismaMock.user.findFirst.mockResolvedValue({ id: USER, fullName: 'Sale A', email: 'sale.a@shop.vn' });
  prismaMock.zaloAccount.findMany.mockResolvedValue([
    {
      id: NICK_A,
      displayName: 'Nick A',
      zaloUid: '111',
      status: 'connected',
      syncPaused: false,
      _count: { friends: 2 },
    },
  ]);
  prismaMock.zaloAccount.updateMany.mockResolvedValue({ count: 1 });
  // Mặc định: không có status nào flag isDefault
  prismaMock.status.findMany.mockResolvedValue([]);
  prismaMock.customerListEntry.findMany.mockResolvedValue([]);
  prismaMock.appointment.count.mockResolvedValue(0);
  prismaMock.note.count.mockResolvedValue(0);
  prismaMock.friend.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.friend.groupBy.mockResolvedValue([]);
  prismaMock.contact.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.contact.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.conversation.findMany.mockResolvedValue([]);
  prismaMock.conversation.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.message.count.mockResolvedValue(0);
  prismaMock.message.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.duplicateGroup.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.parentCandidate.deleteMany.mockResolvedValue({ count: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const model of Object.values(prismaMock)) {
    for (const fn of Object.values(model)) (fn as any).mockReset();
  }
  logActivityMock.mockReset();
  setDefaults();
});

// ── Preview ───────────────────────────────────────────────────────────────

describe('buildPurgePlan — phân loại KH', () => {
  it('giữ KH khi nick của user khác vẫn chăm, chỉ cắt link nick trong phạm vi', async () => {
    // 2 Friend row trong phạm vi: KH shared + KH riêng
    prismaMock.friend.findMany
      // friendsInScope
      .mockResolvedValueOnce([
        { id: 'f1', contactId: 'c-shared' },
        { id: 'f2', contactId: 'c-only' },
      ])
      // sharedRows — c-shared còn nick NGOÀI phạm vi
      .mockResolvedValueOnce([{ contactId: 'c-shared' }]);
    // curated check → không có KH nào curated
    prismaMock.contact.findMany
      .mockResolvedValueOnce([]) // curated filter
      .mockResolvedValueOnce([{ id: 'c-only', fullName: 'KH Riêng', phone: null }]); // sample

    const plan = await buildPurgePlan({ orgId: ORG, userId: USER });

    expect(plan).not.toBeNull();
    expect(plan!.counts.friendsToDelete).toBe(2);
    expect(plan!.counts.contactsToDelete).toBe(1); // chỉ c-only
    expect(plan!.counts.contactsKeptSharedWithOthers).toBe(1); // c-shared
  });

  it('giữ KH đã có dữ liệu người thật nhập khi keepCurated=true', async () => {
    prismaMock.friend.findMany
      .mockResolvedValueOnce([
        { id: 'f1', contactId: 'c-curated' },
        { id: 'f2', contactId: 'c-rac' },
      ])
      .mockResolvedValueOnce([]); // không KH nào shared
    prismaMock.contact.findMany
      .mockResolvedValueOnce([{ id: 'c-curated' }]) // curated
      .mockResolvedValueOnce([{ id: 'c-rac', fullName: 'Rác', phone: null }]); // sample

    const plan = await buildPurgePlan({ orgId: ORG, userId: USER, keepCurated: true });

    expect(plan!.counts.contactsKeptCurated).toBe(1);
    expect(plan!.counts.contactsToDelete).toBe(1);
  });

  it('keepCurated=false thì không chạy filter curated, xoá hết KH mồ côi', async () => {
    prismaMock.friend.findMany
      .mockResolvedValueOnce([
        { id: 'f1', contactId: 'c1' },
        { id: 'f2', contactId: 'c2' },
      ])
      .mockResolvedValueOnce([]);
    prismaMock.contact.findMany.mockResolvedValueOnce([]); // sample

    const plan = await buildPurgePlan({ orgId: ORG, userId: USER, keepCurated: false });

    expect(plan!.counts.contactsToDelete).toBe(2);
    expect(plan!.counts.contactsKeptCurated).toBe(0);
    expect(prismaMock.status.findMany).not.toHaveBeenCalled();
  });

  it('trả null khi user không thuộc org (fail-closed)', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const plan = await buildPurgePlan({ orgId: ORG, userId: 'nguoi-la' });
    expect(plan).toBeNull();
  });

  it('user không có nick nào → plan rỗng, không query friend', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    const plan = await buildPurgePlan({ orgId: ORG, userId: USER });
    expect(plan!.counts.friendsToDelete).toBe(0);
    expect(plan!.accounts).toEqual([]);
    expect(prismaMock.friend.findMany).not.toHaveBeenCalled();
  });

  it('luôn khoá phạm vi theo orgId + ownerUserId', async () => {
    prismaMock.friend.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await buildPurgePlan({ orgId: ORG, userId: USER, zaloAccountIds: [NICK_A, NICK_B_OTHER_USER] });

    const where = prismaMock.zaloAccount.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe(ORG);
    expect(where.ownerUserId).toBe(USER);
    expect(where.id).toEqual({ in: [NICK_A, NICK_B_OTHER_USER] });
  });
});

describe('buildPurgePlan — dấu hiệu "người thật nhập"', () => {
  it('KHÔNG coi assignedUserId = chính chủ nick là dữ liệu người thật', async () => {
    // applyFriendTransition tự claim assignedUserId về chủ nick khi accepted →
    // nếu tính là curated thì MỌI KH sẽ được giữ và tính năng thành vô nghĩa.
    prismaMock.friend.findMany
      .mockResolvedValueOnce([{ id: 'f1', contactId: 'c1' }])
      .mockResolvedValueOnce([]);
    prismaMock.contact.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await buildPurgePlan({ orgId: ORG, userId: USER, keepCurated: true });

    const curatedWhere = prismaMock.contact.findMany.mock.calls[0][0].where;
    const assignedClause = curatedWhere.OR.find(
      (c: any) => Array.isArray(c.AND) && c.AND.some((x: any) => 'assignedUserId' in x),
    );
    // Phải loại trừ chính user đang bị xoá dữ liệu
    expect(assignedClause.AND).toEqual(
      expect.arrayContaining([{ assignedUserId: { not: USER } }]),
    );
  });

  it('KHÔNG coi statusId = status mặc định là dữ liệu người thật', async () => {
    // status-migration gán hàng loạt statusId mặc định cho mọi Contact.
    prismaMock.status.findMany.mockResolvedValue([{ id: 'st-moi' }]);
    prismaMock.friend.findMany
      .mockResolvedValueOnce([{ id: 'f1', contactId: 'c1' }])
      .mockResolvedValueOnce([]);
    prismaMock.contact.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await buildPurgePlan({ orgId: ORG, userId: USER, keepCurated: true });

    const curatedWhere = prismaMock.contact.findMany.mock.calls[0][0].where;
    const statusClause = curatedWhere.OR.find(
      (c: any) => Array.isArray(c.AND) && c.AND.some((x: any) => 'statusId' in x),
    );
    expect(statusClause.AND).toEqual(
      expect.arrayContaining([{ statusId: { notIn: ['st-moi'] } }]),
    );
  });

  it('coi KH nằm trong tệp KH (CustomerList) là dữ liệu người thật', async () => {
    prismaMock.friend.findMany
      .mockResolvedValueOnce([{ id: 'f1', contactId: 'c-in-list' }])
      .mockResolvedValueOnce([]);
    prismaMock.contact.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaMock.customerListEntry.findMany.mockResolvedValue([{ contactId: 'c-in-list' }]);

    const plan = await buildPurgePlan({ orgId: ORG, userId: USER, keepCurated: true });

    expect(plan!.counts.contactsKeptCurated).toBe(1);
    expect(plan!.counts.contactsToDelete).toBe(0);
  });
});

// ── Execute ───────────────────────────────────────────────────────────────

describe('executePurge', () => {
  function mockExecuteFlow(opts: { friendsInScope: Array<{ id: string; contactId: string }> }) {
    prismaMock.friend.findMany
      // buildPurgePlan: friendsInScope
      .mockResolvedValueOnce(opts.friendsInScope)
      // buildPurgePlan: sharedRows
      .mockResolvedValueOnce([])
      // executePurge: affectedRows (distinct contactId)
      .mockResolvedValueOnce(opts.friendsInScope.map((f) => ({ contactId: f.contactId })));
    prismaMock.contact.findMany
      // buildPurgePlan: curated
      .mockResolvedValueOnce([])
      // buildPurgePlan: sample
      .mockResolvedValueOnce([])
      // recomputeDeletableContacts: orphans
      .mockResolvedValueOnce(opts.friendsInScope.map((f) => ({ id: f.contactId })))
      // vòng xoá: xác nhận lại friends:none
      .mockResolvedValueOnce(opts.friendsInScope.map((f) => ({ id: f.contactId })));
    prismaMock.friend.deleteMany.mockResolvedValue({ count: opts.friendsInScope.length });
    prismaMock.contact.deleteMany.mockResolvedValue({ count: opts.friendsInScope.length });
  }

  it('BẮT BUỘC tạm dừng đồng bộ trước khi xoá — nếu không cron sẽ hút lại', async () => {
    mockExecuteFlow({ friendsInScope: [{ id: 'f1', contactId: 'c1' }] });

    const res = await executePurge({ orgId: ORG, userId: USER, actorUserId: 'admin-1' });

    expect(res!.accountsPaused).toEqual([NICK_A]);
    const call = prismaMock.zaloAccount.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: { in: [NICK_A] }, orgId: ORG });
    expect(call.data.syncPaused).toBe(true);
    expect(call.data.syncPausedAt).toBeInstanceOf(Date);

    // Tạm dừng phải xảy ra TRƯỚC khi xoá Friend
    const pauseOrder = prismaMock.zaloAccount.updateMany.mock.invocationCallOrder[0];
    const deleteOrder = prismaMock.friend.deleteMany.mock.invocationCallOrder[0];
    expect(pauseOrder).toBeLessThan(deleteOrder);
  });

  it('xoá Friend row + Contact mồ côi và trả đúng số liệu', async () => {
    mockExecuteFlow({
      friendsInScope: [
        { id: 'f1', contactId: 'c1' },
        { id: 'f2', contactId: 'c2' },
      ],
    });

    const res = await executePurge({ orgId: ORG, userId: USER, actorUserId: 'admin-1' });

    expect(res!.friendsDeleted).toBe(2);
    expect(res!.contactsDeleted).toBe(2);
    expect(prismaMock.friend.deleteMany).toHaveBeenCalledWith({
      where: { orgId: ORG, zaloAccountId: { in: [NICK_A] } },
    });
  });

  it('KHÔNG xoá hội thoại khi deleteConversations=false', async () => {
    mockExecuteFlow({ friendsInScope: [{ id: 'f1', contactId: 'c1' }] });
    await executePurge({ orgId: ORG, userId: USER, actorUserId: 'admin-1' });
    expect(prismaMock.conversation.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.message.deleteMany).not.toHaveBeenCalled();
  });

  it('xoá tin nhắn trước hội thoại khi deleteConversations=true', async () => {
    prismaMock.friend.findMany
      .mockResolvedValueOnce([{ id: 'f1', contactId: 'c1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ contactId: 'c1' }]);
    prismaMock.contact.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'c1' }])
      .mockResolvedValueOnce([{ id: 'c1' }]);
    prismaMock.conversation.findMany.mockResolvedValue([{ id: 'conv-1' }]);
    prismaMock.message.count.mockResolvedValue(7);
    prismaMock.message.deleteMany.mockResolvedValue({ count: 7 });
    prismaMock.conversation.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.friend.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.contact.deleteMany.mockResolvedValue({ count: 1 });

    const res = await executePurge({
      orgId: ORG,
      userId: USER,
      deleteConversations: true,
      actorUserId: 'admin-1',
    });

    expect(res!.messagesDeleted).toBe(7);
    expect(res!.conversationsDeleted).toBe(1);
    const msgOrder = prismaMock.message.deleteMany.mock.invocationCallOrder[0];
    const convOrder = prismaMock.conversation.deleteMany.mock.invocationCallOrder[0];
    expect(msgOrder).toBeLessThan(convOrder);
  });

  it('ghi Activity Log để truy vết', async () => {
    mockExecuteFlow({ friendsInScope: [{ id: 'f1', contactId: 'c1' }] });
    await executePurge({
      orgId: ORG,
      userId: USER,
      actorUserId: 'admin-1',
      actorEmail: 'admin@shop.vn',
    });

    expect(logActivityMock).toHaveBeenCalledTimes(1);
    const logged = logActivityMock.mock.calls[0][0];
    expect(logged.action).toBe('admin_purge_synced_contacts');
    expect(logged.userId).toBe('admin-1');
    expect(logged.details.targetUser.email).toBe('sale.a@shop.vn');
  });

  it('không có nick trong phạm vi → không xoá gì, không tạm dừng gì', async () => {
    prismaMock.zaloAccount.findMany.mockResolvedValue([]);
    const res = await executePurge({ orgId: ORG, userId: USER, actorUserId: 'admin-1' });
    expect(res!.friendsDeleted).toBe(0);
    expect(res!.accountsPaused).toEqual([]);
    expect(prismaMock.zaloAccount.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.friend.deleteMany).not.toHaveBeenCalled();
  });
});

describe('executePurge — sửa counter cho KH được giữ', () => {
  it('tính lại acceptedNicksCount từ Friend còn lại cho KH shared', async () => {
    // c-shared còn nick ngoài phạm vi → được giữ, phải sửa counter
    prismaMock.friend.findMany
      .mockResolvedValueOnce([{ id: 'f1', contactId: 'c-shared' }]) // friendsInScope
      .mockResolvedValueOnce([{ contactId: 'c-shared' }]) // sharedRows
      .mockResolvedValueOnce([{ contactId: 'c-shared' }]); // affectedRows
    prismaMock.contact.findMany
      .mockResolvedValueOnce([]) // curated
      .mockResolvedValueOnce([]) // sample
      .mockResolvedValueOnce([]) // orphans — không có KH nào xoá được
      .mockResolvedValueOnce([]); // withOwner
    prismaMock.friend.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.friend.groupBy.mockResolvedValue([
      { contactId: 'c-shared', relationshipKind: 'friend', _count: { _all: 1 } },
    ]);

    await executePurge({ orgId: ORG, userId: USER, actorUserId: 'admin-1' });

    const counterCall = prismaMock.contact.updateMany.mock.calls.find(
      (c: any) => c[0].data && 'acceptedNicksCount' in c[0].data,
    );
    expect(counterCall).toBeDefined();
    expect(counterCall![0].data).toEqual({
      acceptedNicksCount: 1,
      pendingNicksCount: 0,
      chattingNicksCount: 0,
    });
    expect(counterCall![0].where.id.in).toContain('c-shared');
  });
});

// ── Resume ────────────────────────────────────────────────────────────────

describe('resumeSync', () => {
  it('bỏ cờ tạm dừng và ghi log', async () => {
    prismaMock.zaloAccount.updateMany.mockResolvedValue({ count: 2 });
    const n = await resumeSync(ORG, [NICK_A, 'za-b'], { userId: 'admin-1', email: 'admin@shop.vn' });

    expect(n).toBe(2);
    expect(prismaMock.zaloAccount.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [NICK_A, 'za-b'] }, orgId: ORG },
      data: { syncPaused: false, syncPausedAt: null, syncPausedReason: null },
    });
    expect(logActivityMock.mock.calls[0][0].action).toBe('admin_resume_friend_sync');
  });

  it('danh sách rỗng → no-op', async () => {
    const n = await resumeSync(ORG, [], { userId: 'admin-1' });
    expect(n).toBe(0);
    expect(prismaMock.zaloAccount.updateMany).not.toHaveBeenCalled();
  });
});

// ── Targets ───────────────────────────────────────────────────────────────

describe('listPurgeTargets', () => {
  it('cộng tổng số KH đã đồng bộ qua các nick của từng nhân viên', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: USER,
        fullName: 'Sale A',
        email: 'sale.a@shop.vn',
        role: 'member',
        isActive: true,
        zaloAccounts: [
          { id: NICK_A, displayName: 'A', zaloUid: '1', status: 'connected', syncPaused: false, _count: { friends: 120 } },
          { id: 'za-a2', displayName: 'A2', zaloUid: '2', status: 'disconnected', syncPaused: true, _count: { friends: 35 } },
        ],
      },
    ]);

    const targets = await listPurgeTargets(ORG);

    expect(targets).toHaveLength(1);
    expect(targets[0].totalFriends).toBe(155);
    expect(targets[0].accounts[1].syncPaused).toBe(true);
    // Chỉ lấy user CÓ nick — user không nick thì không có gì để xoá
    expect(prismaMock.user.findMany.mock.calls[0][0].where).toEqual({
      orgId: ORG,
      zaloAccounts: { some: {} },
    });
  });
});
