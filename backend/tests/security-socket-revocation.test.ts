import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: { user: db } }));
vi.mock('../src/shared/utils/logger.js', () => ({ logger: { warn: vi.fn() } }));
import { registerSocketAuth } from '../src/shared/socket-auth.js';
import { revokeUserSockets } from '../src/shared/socket-revocation.js';
const claims = { id: 'fixture-user', orgId: 'fixture-org', role: 'admin' };
beforeEach(() => { vi.clearAllMocks(); db.findUnique.mockResolvedValue({ ...claims, isActive: true }); });
function fixture() {
  let middleware: any, packet: any;
  const socket = { id: 'fixture-socket', handshake: { auth: { token: 'synthetic-token' }, headers: {} }, data: {},
    once: vi.fn(), use: vi.fn((fn: any) => { packet = fn; }), disconnect: vi.fn() };
  registerSocketAuth({ use: (fn: any) => { middleware = fn; } } as any, { jwt: { verify: () => claims } } as any);
  return { socket, next: vi.fn(), middleware, packet: () => packet };
}
describe('socket current-account revocation', () => {
  it('rejects a disabled account at handshake', async () => {
    db.findUnique.mockResolvedValue({ ...claims, isActive: false });
    const f = fixture(); await f.middleware(f.socket, f.next);
    expect(f.next).toHaveBeenCalledWith(expect.any(Error));
    expect(f.socket.use).not.toHaveBeenCalled();
  });
  it('disconnects sockets immediately on an in-process user revocation', async () => {
    const f = fixture(); await f.middleware(f.socket, f.next);
    revokeUserSockets('other-org', claims.id); expect(f.socket.disconnect).not.toHaveBeenCalled();
    revokeUserSockets(claims.orgId, claims.id); expect(f.socket.disconnect).toHaveBeenCalledWith(true);
  });
  it('revalidates account state before socket events', async () => {
    const f = fixture(); await f.middleware(f.socket, f.next);
    db.findUnique.mockResolvedValue({ ...claims, isActive: false });
    const next = vi.fn(); await f.packet()(['org:join'], next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(f.socket.disconnect).toHaveBeenCalledWith(true);
    revokeUserSockets(claims.orgId, claims.id);
  });
});
