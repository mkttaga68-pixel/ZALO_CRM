/**
 * socket-auth.test.ts — xác thực Socket.IO và cách ly room theo org.
 *
 * Đây là test cho lỗ hổng NGHIÊM TRỌNG NHẤT đã tìm thấy: trước đây Socket.IO
 * không xác thực gì, và `org:join` tin `orgId` do client gửi. Một client ẩn danh
 * biết một orgId là đọc được toàn bộ event của tổ chức đó, kể cả mã QR đăng nhập
 * Zalo (emit vào room `account:<id>`) — tức chiếm được nick.
 *
 * Hai tính chất phải giữ mãi:
 *   1. Không token hợp lệ ở handshake  → từ chối kết nối.
 *   2. Room luôn suy ra từ TOKEN, không bao giờ từ payload client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  zaloAccount: { findFirst: vi.fn() },
};

vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: prismaMock }));

// Import AFTER mocks are registered
const { registerSocketAuth, socketIdentity } = await import('../src/shared/socket-auth.js');
const { registerZaloSocketHandlers } = await import('../src/modules/zalo/zalo-socket.js');

const ORG_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ORG_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const USER_A = 'user-a';

type Handshake = { auth?: Record<string, unknown>; headers?: Record<string, unknown> };

function fakeSocket(handshake: Handshake = {}) {
  return {
    id: 'sock-1',
    handshake: { auth: handshake.auth ?? {}, headers: handshake.headers ?? {} },
    data: {} as Record<string, unknown>,
    rooms: new Set<string>(),
    join(room: string) {
      this.rooms.add(room);
    },
    leave(room: string) {
      this.rooms.delete(room);
    },
  };
}

/** Dựng middleware xác thực và trả về hàm để gọi trực tiếp. */
function buildAuthMiddleware(verify: (token: string) => unknown) {
  const middlewares: Array<(socket: unknown, next: (err?: Error) => void) => void> = [];
  const io = { use: (fn: never) => middlewares.push(fn) };
  const app = { jwt: { verify } };
  registerSocketAuth(io as never, app as never);
  expect(middlewares).toHaveLength(1);
  return middlewares[0];
}

/** Dựng handler zalo và trả về bảng event đã đăng ký cho một socket. */
function buildZaloHandlers(socket: ReturnType<typeof fakeSocket>) {
  const events = new Map<string, (...args: never[]) => unknown>();
  const connectionHandlers: Array<(s: unknown) => void> = [];
  const io = { on: (ev: string, fn: (s: unknown) => void) => { if (ev === 'connection') connectionHandlers.push(fn); } };
  registerZaloSocketHandlers(io as never);

  const sock = Object.assign(socket, {
    on: (ev: string, fn: (...args: never[]) => unknown) => { events.set(ev, fn); },
  });
  connectionHandlers.forEach((fn) => fn(sock));
  return events;
}

const validPayload = { id: USER_A, email: 'a@example.com', role: 'owner', orgId: ORG_A };

beforeEach(() => {
  prismaMock.zaloAccount.findFirst.mockReset();
});

describe('registerSocketAuth — handshake', () => {
  it('TỪ CHỐI khi không có token', () => {
    const mw = buildAuthMiddleware(() => validPayload);
    const next = vi.fn();
    mw(fakeSocket(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED');
  });

  it('TỪ CHỐI khi token không verify được (sai chữ ký / hết hạn)', () => {
    const mw = buildAuthMiddleware(() => {
      throw new Error('invalid signature');
    });
    const next = vi.fn();
    const socket = fakeSocket({ auth: { token: 'rác' } });
    mw(socket, next);
    expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED');
    expect(socket.data.identity).toBeUndefined();
  });

  it('TỪ CHỐI token hợp lệ về chữ ký nhưng thiếu orgId', () => {
    const mw = buildAuthMiddleware(() => ({ id: USER_A, role: 'owner' }));
    const next = vi.fn();
    mw(fakeSocket({ auth: { token: 't' } }), next);
    expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED');
  });

  it('TỪ CHỐI token thiếu id', () => {
    const mw = buildAuthMiddleware(() => ({ orgId: ORG_A, role: 'owner' }));
    const next = vi.fn();
    mw(fakeSocket({ auth: { token: 't' } }), next);
    expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED');
  });

  it('CHO QUA token hợp lệ và gắn định danh từ token', () => {
    const mw = buildAuthMiddleware(() => validPayload);
    const next = vi.fn();
    const socket = fakeSocket({ auth: { token: 'tốt' } });
    mw(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socketIdentity(socket as never)).toEqual({
      userId: USER_A,
      orgId: ORG_A,
      role: 'owner',
      email: 'a@example.com',
    });
  });

  it('nhận token qua header Authorization (client không phải browser)', () => {
    const mw = buildAuthMiddleware(() => validPayload);
    const next = vi.fn();
    const socket = fakeSocket({ headers: { authorization: 'Bearer tốt' } });
    mw(socket, next);
    expect(next).toHaveBeenCalledWith();
    expect(socketIdentity(socket as never).orgId).toBe(ORG_A);
  });

  it('mặc định role = member khi token không có claim role', () => {
    const mw = buildAuthMiddleware(() => ({ id: USER_A, orgId: ORG_A }));
    const socket = fakeSocket({ auth: { token: 't' } });
    mw(socket, vi.fn());
    expect(socketIdentity(socket as never).role).toBe('member');
  });

  it('KHÔNG đọc token từ query string — chỉ auth hoặc header', () => {
    const mw = buildAuthMiddleware(() => validPayload);
    const next = vi.fn();
    mw(fakeSocket({ auth: {}, headers: { 'x-token': 'tốt' } }), next);
    expect((next.mock.calls[0][0] as Error).message).toBe('UNAUTHORIZED');
  });
});

describe('org:join — room suy ra từ token, KHÔNG từ payload client', () => {
  it('join đúng org trong token, BỎ QUA orgId client gửi', () => {
    const socket = fakeSocket();
    socket.data.identity = { userId: USER_A, orgId: ORG_A, role: 'owner' };
    const events = buildZaloHandlers(socket);

    // Client cố tình gửi org của người khác — đây chính là đòn tấn công cũ.
    (events.get('org:join') as (d: unknown) => void)({ orgId: ORG_B });

    expect(socket.rooms.has(`org:${ORG_A}`)).toBe(true);
    expect(socket.rooms.has(`org:${ORG_B}`)).toBe(false);
  });

  it('không gửi payload vẫn join được org của mình', () => {
    const socket = fakeSocket();
    socket.data.identity = { userId: USER_A, orgId: ORG_A, role: 'owner' };
    const events = buildZaloHandlers(socket);

    (events.get('org:join') as () => void)();

    expect(socket.rooms.has(`org:${ORG_A}`)).toBe(true);
  });
});

describe('zalo:subscribe — chặn nghe room account của org khác', () => {
  it('CHO join khi account thuộc org của mình', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue({ id: 'acc-1' });
    const socket = fakeSocket();
    socket.data.identity = { userId: USER_A, orgId: ORG_A, role: 'owner' };
    const events = buildZaloHandlers(socket);

    await (events.get('zalo:subscribe') as (d: unknown) => Promise<void>)({ accountId: 'acc-1' });

    expect(prismaMock.zaloAccount.findFirst).toHaveBeenCalledWith({
      where: { id: 'acc-1', orgId: ORG_A },
      select: { id: true },
    });
    expect(socket.rooms.has('account:acc-1')).toBe(true);
  });

  it('CHẶN khi account KHÔNG thuộc org — đây là room phát mã QR đăng nhập Zalo', async () => {
    prismaMock.zaloAccount.findFirst.mockResolvedValue(null);
    const socket = fakeSocket();
    socket.data.identity = { userId: USER_A, orgId: ORG_A, role: 'owner' };
    const events = buildZaloHandlers(socket);

    await (events.get('zalo:subscribe') as (d: unknown) => Promise<void>)({ accountId: 'acc-cua-org-khac' });

    expect(socket.rooms.has('account:acc-cua-org-khac')).toBe(false);
  });

  it('CHẶN khi truy vấn DB lỗi — fail closed, không join', async () => {
    prismaMock.zaloAccount.findFirst.mockRejectedValue(new Error('db down'));
    const socket = fakeSocket();
    socket.data.identity = { userId: USER_A, orgId: ORG_A, role: 'owner' };
    const events = buildZaloHandlers(socket);

    await (events.get('zalo:subscribe') as (d: unknown) => Promise<void>)({ accountId: 'acc-1' });

    expect(socket.rooms.has('account:acc-1')).toBe(false);
  });

  it('bỏ qua khi thiếu accountId, không gọi DB', async () => {
    const socket = fakeSocket();
    socket.data.identity = { userId: USER_A, orgId: ORG_A, role: 'owner' };
    const events = buildZaloHandlers(socket);

    await (events.get('zalo:subscribe') as (d: unknown) => Promise<void>)({});

    expect(prismaMock.zaloAccount.findFirst).not.toHaveBeenCalled();
    expect(socket.rooms.size).toBe(0);
  });

  it('unsubscribe chỉ rời room của chính socket, không cần kiểm tra quyền', () => {
    const socket = fakeSocket();
    socket.data.identity = { userId: USER_A, orgId: ORG_A, role: 'owner' };
    socket.rooms.add('account:acc-1');
    const events = buildZaloHandlers(socket);

    (events.get('zalo:unsubscribe') as (d: unknown) => void)({ accountId: 'acc-1' });

    expect(socket.rooms.has('account:acc-1')).toBe(false);
  });
});
