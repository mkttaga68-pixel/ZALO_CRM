/**
 * contact-hide-routes.test.ts — "Xoá KH khỏi trang Khách hàng" (ẩn, KHÔNG xoá).
 *
 * Điểm cốt lõi phải giữ đúng:
 *  - Chỉ set hiddenAt, TUYỆT ĐỐI không gọi contact.delete → dòng bạn bè, hội thoại,
 *    tin nhắn còn nguyên, và trên Zalo vẫn là bạn.
 *  - Luôn kẹp orgId trong where → không đụng được KH của org khác.
 *  - Danh sách mặc định lọc hiddenAt = null; hidden=only để xem lại + khôi phục.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';

let currentUser = { id: 'u-1', orgId: 'org-1', role: 'admin' as string, email: 'a@x' };

const contactUpdateManyMock = vi.fn();
const contactFindManyMock = vi.fn();
const contactCountMock = vi.fn();
const contactDeleteMock = vi.fn();

vi.mock('../src/modules/auth/auth-middleware.js', () => ({
  authMiddleware: async (req: any) => { req.user = currentUser; },
}));
// Grant contact.delete — test này lo phần nghiệp vụ, RBAC có test riêng.
vi.mock('../src/modules/rbac/rbac-middleware.js', () => ({
  requireGrant: () => async () => {},
}));
vi.mock('../src/shared/database/prisma-client.js', () => ({
  prisma: {
    contact: {
      updateMany: contactUpdateManyMock,
      findMany: contactFindManyMock,
      count: contactCountMock,
      delete: contactDeleteMock,
      findFirst: vi.fn().mockResolvedValue(null),
    },
    friend: { findMany: vi.fn().mockResolvedValue([]), groupBy: vi.fn().mockResolvedValue([]) },
    conversation: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock('../src/shared/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../src/modules/activity/activity-logger.js', () => ({ logActivity: vi.fn() }));
vi.mock('../src/modules/contacts/contact-aggregate-display.js', () => ({
  computeAggregateDisplay: (c: any) => c,
  AGGREGATE_INCLUDE: {},
}));
vi.mock('../src/modules/automation/automation-service.js', () => ({ runAutomationRules: vi.fn() }));

const { contactRoutes } = await import('../src/modules/contacts/contact-routes.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // GET /contacts hỏi slot scope của plugin host (EE plugin có thể thu hẹp phạm vi KH).
  // Bản community resolve trả null = không lọc thêm.
  app.decorate('scope', { resolve: async () => null } as any);
  await app.register(contactRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUser = { id: 'u-1', orgId: 'org-1', role: 'admin', email: 'a@x' };
  contactUpdateManyMock.mockReset().mockResolvedValue({ count: 0 });
  contactFindManyMock.mockReset().mockResolvedValue([]);
  contactCountMock.mockReset().mockResolvedValue(0);
  contactDeleteMock.mockReset();
});

describe('POST /api/v1/contacts/bulk-hide', () => {
  it('chỉ set hiddenAt, KHÔNG xoá bản ghi KH', async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 2 });
    const res = await (await buildApp()).inject({
      method: 'POST',
      url: '/api/v1/contacts/bulk-hide',
      payload: { contactIds: ['c1', 'c2'] },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, hidden: 2 });

    // Không được xoá gì — dòng bạn bè / hội thoại / tin nhắn phải còn nguyên
    expect(contactDeleteMock).not.toHaveBeenCalled();

    const call = contactUpdateManyMock.mock.calls[0][0];
    expect(call.where.id).toEqual({ in: ['c1', 'c2'] });
    expect(call.where.orgId).toBe('org-1');      // fail-closed theo org
    expect(call.where.hiddenAt).toBeNull();       // bấm 2 lần không ghi đè mốc ẩn đầu
    expect(call.data.hiddenAt).toBeInstanceOf(Date);
    expect(call.data.hiddenByUserId).toBe('u-1');
  });

  it('từ chối khi không chọn KH nào', async () => {
    const res = await (await buildApp()).inject({
      method: 'POST', url: '/api/v1/contacts/bulk-hide', payload: { contactIds: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(contactUpdateManyMock).not.toHaveBeenCalled();
  });

  it('chặn payload quá lớn (>1000 KH)', async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    const res = await (await buildApp()).inject({
      method: 'POST', url: '/api/v1/contacts/bulk-hide', payload: { contactIds: ids },
    });
    expect(res.statusCode).toBe(400);
    expect(contactUpdateManyMock).not.toHaveBeenCalled();
  });

  it('bỏ qua phần tử không phải chuỗi trong danh sách', async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 1 });
    await (await buildApp()).inject({
      method: 'POST',
      url: '/api/v1/contacts/bulk-hide',
      payload: { contactIds: ['c1', null, 123, '', { id: 'x' }] },
    });
    expect(contactUpdateManyMock.mock.calls[0][0].where.id).toEqual({ in: ['c1'] });
  });
});

describe('POST /api/v1/contacts/bulk-unhide', () => {
  it('khôi phục KH về trang', async () => {
    contactUpdateManyMock.mockResolvedValue({ count: 3 });
    const res = await (await buildApp()).inject({
      method: 'POST',
      url: '/api/v1/contacts/bulk-unhide',
      payload: { contactIds: ['c1', 'c2', 'c3'] },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, restored: 3 });

    const call = contactUpdateManyMock.mock.calls[0][0];
    expect(call.where.orgId).toBe('org-1');
    expect(call.where.hiddenAt).toEqual({ not: null }); // chỉ đụng KH đang ẩn
    expect(call.data).toEqual({ hiddenAt: null, hiddenByUserId: null });
    expect(contactDeleteMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/contacts — lọc KH đã ẩn', () => {
  it('mặc định chỉ trả KH chưa ẩn', async () => {
    await (await buildApp()).inject({ method: 'GET', url: '/api/v1/contacts' });
    expect(contactFindManyMock.mock.calls[0][0].where.hiddenAt).toBeNull();
  });

  it('hidden=only trả đúng KH đã ẩn (để khôi phục)', async () => {
    await (await buildApp()).inject({ method: 'GET', url: '/api/v1/contacts?hidden=only' });
    expect(contactFindManyMock.mock.calls[0][0].where.hiddenAt).toEqual({ not: null });
  });
});
