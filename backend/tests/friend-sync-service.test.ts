/**
 * friend-sync-service.test.ts — Unit tests cho syncFriendsForAccount.
 * Coverage: cooldown gate, SDK fetch error, contact create, diff-then-emit,
 * empty patch skip, identity update emit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockZaloOps } from './test-helpers.js';

const zaloOpsMock = mockZaloOps();

const prismaMock = {
  contact: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  friend: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
};

const applyFriendTransitionMock = vi.fn().mockResolvedValue(undefined);
const logActivityMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));
vi.mock('../src/shared/zalo-operations.js', () => ({ zaloOps: zaloOpsMock }));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/zalo/friend-event-handler.js', () => ({
  applyFriendTransition: applyFriendTransitionMock,
}));
vi.mock('../src/modules/activity/activity-logger.js', () => ({
  logActivity: logActivityMock,
}));

const { syncFriendsForAccount } = await import('../src/modules/zalo/friend-sync-service.js');

function mockIO() {
  const toMock = { emit: vi.fn() };
  return {
    to: vi.fn(() => toMock),
    emit: vi.fn(),
    _toMock: toMock,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contact.findFirst.mockReset();
  prismaMock.contact.create.mockReset();
  prismaMock.friend.findMany.mockReset();
  prismaMock.friend.update.mockReset();
  applyFriendTransitionMock.mockReset().mockResolvedValue(undefined);
  zaloOpsMock.getAllFriends.mockReset().mockResolvedValue([]);
  zaloOpsMock.getSentFriendRequests.mockReset().mockResolvedValue([]);
});

describe('syncFriendsForAccount — cooldown gate', () => {
  it('returns skipped=cooldown when manual trigger spammed within 5s', async () => {
    prismaMock.friend.findMany.mockResolvedValue([]);
    // First call → succeed
    const r1 = await syncFriendsForAccount('za-spam', 'org-1', { trigger: 'manual' });
    expect(r1.skipped).toBeNull();
    // Second call immediately → cooldown
    const r2 = await syncFriendsForAccount('za-spam', 'org-1', { trigger: 'manual' });
    expect(r2.skipped).toBe('cooldown');
  });

  it('cron trigger bypasses cooldown', async () => {
    prismaMock.friend.findMany.mockResolvedValue([]);
    await syncFriendsForAccount('za-cron', 'org-1', { trigger: 'manual' });
    const r2 = await syncFriendsForAccount('za-cron', 'org-1', { trigger: 'cron' });
    expect(r2.skipped).toBeNull();
  });

  it('connect trigger bypasses cooldown', async () => {
    prismaMock.friend.findMany.mockResolvedValue([]);
    await syncFriendsForAccount('za-conn', 'org-1', { trigger: 'manual' });
    const r2 = await syncFriendsForAccount('za-conn', 'org-1', { trigger: 'connect' });
    expect(r2.skipped).toBeNull();
  });
});

describe('syncFriendsForAccount — SDK fetch errors', () => {
  it('logs activity error when getAllFriends throws', async () => {
    zaloOpsMock.getAllFriends.mockRejectedValue(new Error('rate_limited'));
    zaloOpsMock.getSentFriendRequests.mockRejectedValue(new Error('rate_limited'));
    prismaMock.friend.findMany.mockResolvedValue([]);
    const r = await syncFriendsForAccount('za-err', 'org-1', { trigger: 'cron' });
    // B4 fix: SDK fetch error bubble lên outer catch → errors++ + logActivity, return sớm.
    // liveCount=0 nhưng errors>0 để phân biệt với "0 friends" thật (sale biết sync fail).
    expect(r.liveCount).toBe(0);
    expect(r.errors).toBe(1);
  });
});

describe('syncFriendsForAccount — diff-then-emit', () => {
  it('emits friend:updated only when identity field changed', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([
      { userId: 'uid-1', zaloName: 'Anh Tuấn MỚI', avatar: 'http://a.png', globalId: 'g1', username: 'tuan' },
    ]);
    prismaMock.friend.findMany.mockResolvedValue([
      {
        id: 'f1',
        contactId: 'c1',
        zaloUidInNick: 'uid-1',
        friendshipStatus: 'accepted',   // trạng thái đã đúng
        zaloDisplayName: 'Anh Tuấn',   // CŨ
        zaloAvatarUrl: 'http://a.png',  // không đổi
        zaloGlobalId: 'g1',
        zaloUsername: 'tuan',
      },
    ]);
    prismaMock.contact.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.friend.update.mockResolvedValue({
      id: 'f1', contactId: 'c1', zaloAccountId: 'za-d',
    });
    const io = mockIO();
    const r = await syncFriendsForAccount('za-d', 'org-1', { trigger: 'cron', io });
    expect(r.emittedCount).toBe(1);
    expect(io.to).toHaveBeenCalledWith('org:org-1');
    expect(io._toMock.emit).toHaveBeenCalledWith(
      'friend:updated',
      expect.objectContaining({
        friendId: 'f1',
        patch: { zaloDisplayName: 'Anh Tuấn MỚI' },  // chỉ field đổi
      }),
    );
  });

  it('SKIP emit when no field changed (typical cron run)', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([
      { userId: 'uid-1', zaloName: 'Anh Tuấn', avatar: 'http://a.png', globalId: 'g1', username: 'tuan' },
    ]);
    prismaMock.friend.findMany.mockResolvedValue([
      {
        id: 'f1',
        contactId: 'c1',
        zaloUidInNick: 'uid-1',
        friendshipStatus: 'accepted',
        zaloDisplayName: 'Anh Tuấn',
        zaloAvatarUrl: 'http://a.png',
        zaloGlobalId: 'g1',
        zaloUsername: 'tuan',
      },
    ]);
    prismaMock.contact.findFirst.mockResolvedValue({ id: 'c1' });
    const io = mockIO();
    const r = await syncFriendsForAccount('za-noop', 'org-1', { trigger: 'cron', io });
    expect(r.emittedCount).toBe(0);
    expect(prismaMock.friend.update).not.toHaveBeenCalled();
    expect(io._toMock.emit).not.toHaveBeenCalled();
  });
});

// ── Ràng buộc: lần sync 2+ chỉ xử lý người CHƯA CÓ / CÓ ĐỔI ───────────────

function existingRow(uid: string, over: Record<string, unknown> = {}) {
  return {
    id: `f-${uid}`,
    contactId: `c-${uid}`,
    zaloUidInNick: uid,
    friendshipStatus: 'accepted',
    zaloDisplayName: `KH ${uid}`,
    zaloAvatarUrl: `http://${uid}.png`,
    zaloGlobalId: `g-${uid}`,
    zaloUsername: `u-${uid}`,
    ...over,
  };
}

function liveFriend(uid: string, over: Record<string, unknown> = {}) {
  return {
    userId: uid,
    zaloName: `KH ${uid}`,
    avatar: `http://${uid}.png`,
    globalId: `g-${uid}`,
    username: `u-${uid}`,
    ...over,
  };
}

describe('syncFriendsForAccount — đồng bộ lần 2+ không đổi thì giữ nguyên', () => {
  it('toàn bộ không đổi → bỏ qua sạch: 0 ghi, 0 transition, 0 emit', async () => {
    const uids = ['a1', 'a2', 'a3'];
    zaloOpsMock.getAllFriends.mockResolvedValue(uids.map((u) => liveFriend(u)));
    prismaMock.friend.findMany.mockResolvedValue(uids.map((u) => existingRow(u)));
    const io = mockIO();

    const r = await syncFriendsForAccount('za-stable', 'org-1', { trigger: 'cron', io });

    expect(r.liveCount).toBe(3);
    expect(r.skippedUnchanged).toBe(3);
    expect(r.newFriends).toBe(0);
    expect(r.updatedFriends).toBe(0);
    expect(r.upsertedFriends).toBe(0);
    // Không chạm DB ngoài 1 query pre-load, không gọi state machine
    expect(applyFriendTransitionMock).not.toHaveBeenCalled();
    expect(prismaMock.friend.update).not.toHaveBeenCalled();
    expect(prismaMock.contact.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
    expect(io._toMock.emit).not.toHaveBeenCalled();
  });

  it('chỉ đồng bộ người CHƯA CÓ trong hệ thống', async () => {
    // 2 người đã có (không đổi) + 1 người mới
    zaloOpsMock.getAllFriends.mockResolvedValue([
      liveFriend('a1'),
      liveFriend('a2'),
      liveFriend('moi'),
    ]);
    prismaMock.friend.findMany.mockResolvedValue([existingRow('a1'), existingRow('a2')]);
    prismaMock.contact.findFirst.mockResolvedValue(null);
    prismaMock.contact.create.mockResolvedValue({ id: 'c-moi' });
    prismaMock.friend.update.mockResolvedValue({
      id: 'f-moi', contactId: 'c-moi', zaloAccountId: 'za-mix', zaloUidInNick: 'moi',
    });

    const r = await syncFriendsForAccount('za-mix', 'org-1', { trigger: 'cron' });

    expect(r.skippedUnchanged).toBe(2);
    expect(r.newFriends).toBe(1);
    expect(r.createdContacts).toBe(1);
    // Chỉ người mới được chạy state machine
    expect(applyFriendTransitionMock).toHaveBeenCalledTimes(1);
    expect(applyFriendTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ zaloUidInNick: 'moi', contactId: 'c-moi' }),
    );
  });

  it('số lượng KHÔNG đổi nhưng có người mới thay người cũ → vẫn thêm người mới', async () => {
    // Zalo trả 2 bạn, DB cũng có 2 Friend row → tổng không đổi.
    // Nhưng 'cu' đã huỷ kết bạn và 'moi' vừa thêm vào.
    // So theo số lượng sẽ bỏ sót 'moi'; so theo UID thì không.
    zaloOpsMock.getAllFriends.mockResolvedValue([liveFriend('a1'), liveFriend('moi')]);
    prismaMock.friend.findMany.mockResolvedValue([existingRow('a1')]); // chỉ a1 khớp UID
    prismaMock.contact.findFirst.mockResolvedValue({ id: 'c-moi' });
    prismaMock.friend.update.mockResolvedValue({
      id: 'f-moi', contactId: 'c-moi', zaloAccountId: 'za-swap', zaloUidInNick: 'moi',
    });

    const r = await syncFriendsForAccount('za-swap', 'org-1', { trigger: 'cron' });

    expect(r.newFriends).toBe(1);
    expect(r.skippedUnchanged).toBe(1);
    expect(applyFriendTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ zaloUidInNick: 'moi' }),
    );
  });

  it('đổi danh tính → chỉ ghi phần đổi, KHÔNG resolve Contact lại', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([liveFriend('a1', { zaloName: 'Tên MỚI' })]);
    prismaMock.friend.findMany.mockResolvedValue([existingRow('a1')]);
    prismaMock.friend.update.mockResolvedValue({
      id: 'f-a1', contactId: 'c-a1', zaloAccountId: 'za-rename', zaloUidInNick: 'a1',
    });
    const io = mockIO();

    const r = await syncFriendsForAccount('za-rename', 'org-1', { trigger: 'cron', io });

    expect(r.updatedFriends).toBe(1);
    expect(r.skippedUnchanged).toBe(0);
    // contactId lấy từ Friend row sẵn có → không query Contact
    expect(prismaMock.contact.findFirst).not.toHaveBeenCalled();
    // Trạng thái không đổi → không chạy state machine
    expect(applyFriendTransitionMock).not.toHaveBeenCalled();
    expect(prismaMock.friend.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { zaloDisplayName: 'Tên MỚI' } }),
    );
    expect(io._toMock.emit).toHaveBeenCalledTimes(1);
  });

  it('đổi trạng thái kết bạn → chạy state machine với contactId có sẵn', async () => {
    // DB đang pending_sent, Zalo đã accepted
    zaloOpsMock.getAllFriends.mockResolvedValue([liveFriend('a1')]);
    prismaMock.friend.findMany.mockResolvedValue([
      existingRow('a1', { friendshipStatus: 'pending_sent' }),
    ]);

    const r = await syncFriendsForAccount('za-accept', 'org-1', { trigger: 'cron' });

    expect(r.updatedFriends).toBe(1);
    expect(applyFriendTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c-a1',
        zaloUidInNick: 'a1',
        newFriendshipStatus: 'accepted',
        source: 'sync',
      }),
    );
    // Danh tính không drift → không ghi thêm
    expect(prismaMock.friend.update).not.toHaveBeenCalled();
  });
});

describe('syncFriendsForAccount — loại trùng UID trong lô', () => {
  it('UID ở CẢ 2 danh sách → chỉ xử lý 1 lần và giữ accepted (không hạ về pending)', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([liveFriend('dup')]);
    zaloOpsMock.getSentFriendRequests.mockResolvedValue([{ uid: 'dup', zaloName: 'KH dup' }]);
    prismaMock.friend.findMany.mockResolvedValue([
      existingRow('dup', { friendshipStatus: 'none' }),
    ]);

    const r = await syncFriendsForAccount('za-dup', 'org-1', { trigger: 'cron' });

    expect(r.liveCount).toBe(1); // không cộng trùng 2 danh sách
    expect(applyFriendTransitionMock).toHaveBeenCalledTimes(1);
    expect(applyFriendTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({ newFriendshipStatus: 'accepted' }),
    );
  });

  it('UID trùng trong cùng getAllFriends → đếm 1, merge snapshot', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([
      liveFriend('a1', { globalId: '' }),
      liveFriend('a1'),
    ]);
    prismaMock.friend.findMany.mockResolvedValue([existingRow('a1')]);

    const r = await syncFriendsForAccount('za-dup2', 'org-1', { trigger: 'cron' });

    expect(r.liveCount).toBe(1);
    expect(r.skippedUnchanged).toBe(1);
  });

  it('bản ghi trùng bị thiếu field KHÔNG được xoá giá trị bản ghi trước đã có', async () => {
    // Bản ghi sau rỗng avatar + globalId → nếu merge thô sẽ sinh patch null
    // và wipe avatar/globalId đang lưu. Phải coi là KHÔNG ĐỔI.
    zaloOpsMock.getAllFriends.mockResolvedValue([
      liveFriend('a1'),
      liveFriend('a1', { avatar: '', globalId: '', username: '' }),
    ]);
    prismaMock.friend.findMany.mockResolvedValue([existingRow('a1')]);

    const r = await syncFriendsForAccount('za-dup3', 'org-1', { trigger: 'cron' });

    expect(r.skippedUnchanged).toBe(1);
    expect(prismaMock.friend.update).not.toHaveBeenCalled();
  });
});

describe('syncFriendsForAccount — contact resolution', () => {
  it('reuses existing Contact when zaloUid match', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([
      { userId: 'uid-2', zaloName: 'KH Cũ', avatar: '', globalId: '', username: '' },
    ]);
    prismaMock.friend.findMany.mockResolvedValue([]); // no existing friend
    prismaMock.contact.findFirst.mockResolvedValue({ id: 'c-existing' });
    prismaMock.friend.update.mockResolvedValue({
      id: 'f-new', contactId: 'c-existing', zaloAccountId: 'za-x',
    });
    const r = await syncFriendsForAccount('za-x', 'org-1', { trigger: 'cron' });
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
    expect(r.createdContacts).toBe(0);
    expect(applyFriendTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: 'c-existing',
        newFriendshipStatus: 'accepted',
      }),
    );
  });

  it('creates stub Contact when zaloUid not found', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([
      { userId: 'uid-3', zaloName: 'KH Mới Tạo', avatar: 'avatar.png', globalId: '', username: '' },
    ]);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.contact.findFirst.mockResolvedValue(null);
    prismaMock.contact.create.mockResolvedValue({ id: 'c-new' });
    prismaMock.friend.update.mockResolvedValue({
      id: 'f-new', contactId: 'c-new', zaloAccountId: 'za-y',
    });
    const r = await syncFriendsForAccount('za-y', 'org-1', { trigger: 'cron' });
    expect(r.createdContacts).toBe(1);
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        zaloUid: 'uid-3',
        fullName: 'KH Mới Tạo',
        avatarUrl: 'avatar.png',
        hasZalo: true,
      }),
      select: { id: true, fullName: true },
    });
  });
});

describe('syncFriendsForAccount — pending sent requests', () => {
  it('processes sent requests with pending_sent status', async () => {
    zaloOpsMock.getAllFriends.mockResolvedValue([]);
    zaloOpsMock.getSentFriendRequests.mockResolvedValue([
      { uid: 'uid-p', zaloName: 'KH Pending', avatar: '', globalId: '', username: '' },
    ]);
    prismaMock.friend.findMany.mockResolvedValue([]);
    prismaMock.contact.findFirst.mockResolvedValue({ id: 'c-p' });
    prismaMock.friend.update.mockResolvedValue({
      id: 'f-p', contactId: 'c-p', zaloAccountId: 'za-p',
    });
    await syncFriendsForAccount('za-p', 'org-1', { trigger: 'cron' });
    expect(applyFriendTransitionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        newFriendshipStatus: 'pending_sent',
      }),
    );
  });
});
