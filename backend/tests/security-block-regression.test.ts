import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
const db = vi.hoisted(() => ({
  block: { findFirst: vi.fn(), update: vi.fn() },
  blockFolder: { findFirst: vi.fn() }, zaloAccount: { findFirst: vi.fn() },
}));
vi.mock('../src/shared/database/prisma-client.js', () => ({ prisma: db }));
vi.mock('../src/modules/auth/auth-middleware.js', () => ({ authMiddleware: async (r: any) => { r.user = { id: 'fixture-user', orgId: 'fixture-org', role: 'owner' }; } }));
vi.mock('../src/modules/rbac/rbac-middleware.js', () => ({ requireGrant: () => async () => {} }));
vi.mock('../src/shared/utils/logger.js', () => ({ logger: { error: vi.fn() } }));
import { blockRoutes } from '../src/modules/automation/blocks/block-routes.js';
beforeEach(() => {
  vi.clearAllMocks();
  db.block.findFirst.mockResolvedValue({ id: 'fixture-block', actionType: 'send_message', content: { textVariants: ['fixture'] }, archivedAt: null });
  db.block.update.mockResolvedValue({ id: 'fixture-block' });
  db.blockFolder.findFirst.mockResolvedValue(null); db.zaloAccount.findFirst.mockResolvedValue(null);
});
async function put(payload: unknown) {
  const app = Fastify(); await app.register(blockRoutes);
  try { return await app.inject({ method: 'PUT', url: '/api/v1/automation/blocks/fixture-block', payload: payload as any }); }
  finally { await app.close(); }
}
describe('block update regression', () => {
  for (const field of ['folderId', 'ownerNickId']) it(`rejects inaccessible ${field}`, async () => {
    expect((await put({ [field]: 'other-tenant-id' })).statusCode).toBe(400);
    expect(db.block.update).not.toHaveBeenCalled();
  });
  it('checks retained content against a changed action type', async () => {
    expect((await put({ actionType: 'update_status' })).statusCode).toBe(400);
    expect(db.block.update).not.toHaveBeenCalled();
  });
  it('allows a normal rename without changing valid content', async () => {
    expect((await put({ name: 'new name' })).statusCode).toBe(200);
  });
});
