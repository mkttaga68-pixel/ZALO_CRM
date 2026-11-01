import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: { user: db } }));
import { authMiddleware, optionalAuthMiddleware } from '../src/modules/auth/auth-middleware.js';
import { userHasGrant } from '../src/modules/rbac/permission-group-service.js';

function request() {
  return { user: { id: 'fixture-user', orgId: 'fixture-org', role: 'admin' }, jwtVerify: vi.fn().mockResolvedValue(undefined) };
}
function reply() {
  const r = { code: 200, payload: undefined as unknown, status(n: number) { this.code = n; return this; }, send(p: unknown) { this.payload = p; return this; } };
  return r;
}
beforeEach(() => vi.clearAllMocks());
describe('current account authorization', () => {
  for (const account of [null, { id: 'fixture-user', orgId: 'fixture-org', role: 'admin', isActive: false },
    { id: 'fixture-user', orgId: 'other-org', role: 'admin', isActive: true },
    { id: 'fixture-user', orgId: 'fixture-org', role: 'member', isActive: true }]) {
    it(`rejects stale token for ${JSON.stringify(account)}`, async () => {
      db.findUnique.mockResolvedValue(account);
      const r = reply(); await authMiddleware(request() as any, r as any);
      expect(r.code).toBe(401);
    });
  }
  it('fails closed when the account store is unavailable', async () => {
    db.findUnique.mockRejectedValue(new Error('fixture unavailable'));
    const r = reply(); await authMiddleware(request() as any, r as any);
    expect(r.code).toBe(503);
  });
  it('allows active account in the token tenant and role', async () => {
    db.findUnique.mockResolvedValue({ id: 'fixture-user', orgId: 'fixture-org', role: 'admin', isActive: true });
    const r = reply(); await authMiddleware(request() as any, r as any);
    expect(r.code).toBe(200);
  });
  it('denies inactive legacy owners at the RBAC boundary', async () => {
    db.findUnique.mockResolvedValue({ role: 'owner', isActive: false });
    expect(await userHasGrant('fixture-user', 'block', 'edit')).toBe(false);
  });
  it('keeps optional authentication anonymous without a valid token', async () => {
    const req = request(); req.jwtVerify.mockRejectedValue(new Error('no token'));
    const r = reply(); await optionalAuthMiddleware(req as any, r as any);
    expect(db.findUnique).not.toHaveBeenCalled(); expect(r.code).toBe(200);
  });
  it('rejects a disabled account even on a plugin using optional authentication', async () => {
    db.findUnique.mockResolvedValue({ isActive: false });
    const r = reply(); await optionalAuthMiddleware(request() as any, r as any);
    expect(r.code).toBe(401);
  });
});
