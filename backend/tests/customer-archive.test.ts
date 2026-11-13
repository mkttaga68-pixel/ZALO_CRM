/**
 * "Lưu trữ tin nhắn" (thay trang Huấn luyện): thống kê thuần + cổng quyền + lưu tham chiếu (không chép nội dung).
 * Prisma được thay bằng dữ liệu giả trong bộ nhớ — không chạm DB thật.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { QcError, type Actor } from '../src/modules/ai-quality-control/contracts.js';
import { MemoryWorkspaceRepository } from '../src/modules/ai-quality-control/repository.js';

const ORG = 'org-A', C1 = '11111111-1111-4111-8111-111111111111', C2 = '22222222-2222-4222-8222-222222222222';
const at = (iso: string) => new Date(iso);
const db = vi.hoisted(() => ({
    conversations: [] as Array<{ id: string; orgId: string; contactId: string; threadType: string; lastMessageAt: Date; zaloAccountId: string; zaloAccount: { displayName: string } }>,
    messages: [] as Array<{ id: string; conversationId: string; content: string; contentType: string; senderType: string; senderName: string | null; sentAt: Date; sentVia: string; isDeleted: boolean }>,
}));
vi.mock('../src/shared/database/prisma-client.js', () => {
    const inIds = (where: any, id: string) => !where?.conversationId?.in || where.conversationId.in.includes(id);
    const msgs = (where: any) => db.messages.filter(m => inIds(where, m.conversationId) && m.isDeleted === false && (!where?.sentAt?.lt || m.sentAt < where.sentAt.lt));
    return { prisma: {
        conversation: { findMany: async ({ where }: any) => db.conversations.filter(c => c.orgId === where.orgId && (!where.contactId || typeof where.contactId !== 'string' || c.contactId === where.contactId)).sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime())
            .map(c => ({ ...c, contact: { crmName: c.contactId === C1 ? 'Chị Lan' : 'Anh Minh', fullName: null, zaloUsername: null } })) },
        message: {
            findMany: async ({ where, orderBy, take }: any) => { const rows = msgs(where).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime()); void orderBy; return rows.slice(0, take); },
            groupBy: async ({ where }: any) => { const map = new Map<string, number>(); for (const m of msgs(where)) map.set(m.conversationId + '|' + m.senderType, (map.get(m.conversationId + '|' + m.senderType) ?? 0) + 1); return [...map].map(([k, n]) => ({ conversationId: k.split('|')[0], senderType: k.split('|')[1], _count: { _all: n } })); },
        },
        contact: {
            findFirst: async ({ where }: any) => ({ crmName: where.id === C1 ? 'Chị Lan' : 'Anh Minh', fullName: null, zaloUsername: null, firstContactDate: null }),
            findMany: async ({ where }: any) => where.id.in.map((id: string) => ({ id, crmName: id === C1 ? 'Chị Lan' : 'Anh Minh', fullName: null, zaloUsername: null, lastActivity: null })),
        },
        zaloAccount: { findMany: async () => [{ id: 'acc-1' }] },
        zaloAccountAccess: { findMany: async () => [] },
    } };
});
const { customerMessageStats, registerCustomerArchiveRoutes } = await import('../src/modules/ai-quality-control/customer-archive.js');

const staff: Actor = { id: 'staff-1', orgId: ORG, departmentIds: [], permissions: ['access'] };
const other: Actor = { id: 'staff-2', orgId: ORG, departmentIds: [], permissions: ['access'] };
const noAccess: Actor = { id: 'nobody', orgId: ORG, departmentIds: [], permissions: [] };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });

function seed() {
    db.conversations = [
        { id: 'conv-1', orgId: ORG, contactId: C1, threadType: 'user', lastMessageAt: at('2026-11-10T03:00:00Z'), zaloAccountId: 'acc-1', zaloAccount: { displayName: 'Zalo Sale 1' } },
        { id: 'conv-2', orgId: ORG, contactId: C2, threadType: 'user', lastMessageAt: at('2026-11-09T03:00:00Z'), zaloAccountId: 'acc-2', zaloAccount: { displayName: 'Zalo Sale 2' } },
    ];
    db.messages = [
        { id: 'm1', conversationId: 'conv-1', content: 'Chào shop', contentType: 'text', senderType: 'contact', senderName: null, sentAt: at('2026-11-10T02:00:00Z'), sentVia: 'user', isDeleted: false },
        { id: 'm2', conversationId: 'conv-1', content: 'Dạ em chào chị', contentType: 'text', senderType: 'self', senderName: 'Sale', sentAt: at('2026-11-10T02:03:00Z'), sentVia: 'user', isDeleted: false },
        { id: 'm3', conversationId: 'conv-1', content: '', contentType: 'image', senderType: 'contact', senderName: null, sentAt: at('2026-11-10T02:10:00Z'), sentVia: 'user', isDeleted: false },
        { id: 'm4', conversationId: 'conv-1', content: 'đã xoá', contentType: 'text', senderType: 'contact', senderName: null, sentAt: at('2026-11-10T02:11:00Z'), sentVia: 'user', isDeleted: true },
        { id: 'm5', conversationId: 'conv-2', content: 'Tin của khách khác', contentType: 'text', senderType: 'contact', senderName: null, sentAt: at('2026-11-09T02:00:00Z'), sentVia: 'user', isDeleted: false },
    ];
}
async function build(options: { realData?: boolean; orgId?: string; denied?: string[] } = {}) {
    seed();
    const repo = new MemoryWorkspaceRepository();
    const app = Fastify({ logger: false }); apps.push(app);
    app.decorate('scope', { resolve: async () => ({}) });
    app.addHook('preHandler', async request => { (request as any).user = { id: request.headers['x-actor'], orgId: ORG, role: 'member' }; });
    const actors: Record<string, Actor> = { [staff.id]: staff, [other.id]: other, [noAccess.id]: noAccess };
    await registerCustomerArchiveRoutes(app, { repo, actor: async r => actors[String(r.headers['x-actor'])]!, enabled: () => true, realData: () => options.realData ?? true, realDataOrgId: options.orgId ?? ORG,
        authorize: async (_a, id) => { if ((options.denied ?? ['conv-2']).includes(id)) throw new QcError('CONVERSATION_NOT_FOUND', 404); } });
    const call = async (a: Actor, method: 'GET' | 'POST' | 'DELETE', url: string) => { const r = await app.inject({ method, url: '/api/v1/ai-quality-control/customer-archive' + url, headers: { 'x-actor': a.id } }); return { status: r.statusCode, body: r.json() as Record<string, any> }; };
    return { repo, call };
}

describe('customerMessageStats', () => {
    it('counts customer vs our messages, types, Vietnam-time hours and reply time (bot replies excluded)', () => {
        const s = customerMessageStats([
            { sentAt: at('2026-11-10T02:00:00Z'), senderType: 'contact', contentType: 'text', sentVia: 'user', conversationId: 'c' },
            { sentAt: at('2026-11-10T02:00:30Z'), senderType: 'contact', contentType: 'image', sentVia: 'user', conversationId: 'c' },
            { sentAt: at('2026-11-10T02:01:00Z'), senderType: 'self', contentType: 'text', sentVia: 'automation', conversationId: 'c' },
            { sentAt: at('2026-11-10T02:04:00Z'), senderType: 'self', contentType: 'text', sentVia: 'user', conversationId: 'c' },
            { sentAt: at('2026-11-11T15:00:00Z'), senderType: 'contact', contentType: 'text', sentVia: 'user', conversationId: 'c' },
        ], { c: 'Zalo Sale 1' }, at('2026-11-13T00:00:00Z'));
        expect(s).toMatchObject({ total: 5, customer: 3, ours: 2, automation: 1, activeDays: 2, byType: { text: 2, image: 1 } });
        expect(s.reply).toEqual({ count: 1, unanswered: 1, medianSeconds: 240, within5Minutes: 1 });
        expect(s.byHour[9]).toBe(2); // 02:00Z = 09:00 giờ VN
        expect(s.byHour[22]).toBe(1); // 15:00Z = 22:00 giờ VN
        expect(s.byMonth).toHaveLength(12);
        expect(s.byMonth.at(-1)).toEqual({ month: '2026-11', customer: 3, ours: 2 });
        expect(s.byAccount).toEqual([{ account: 'Zalo Sale 1', customer: 3, ours: 2 }]);
    });
    it('handles a customer with no messages', () => {
        const s = customerMessageStats([], {});
        expect(s).toMatchObject({ total: 0, firstAt: null, lastAt: null, reply: { count: 0, unanswered: 0, medianSeconds: null } });
    });
});

describe('customer archive routes', () => {
    it('is closed unless real CRM data is enabled for this tenant, and needs the access permission', async () => {
        expect((await (await build({ realData: false })).call(staff, 'GET', '')).body.error).toBe('AI_QC_REAL_DATA_DISABLED');
        expect((await (await build({ orgId: 'org-B' })).call(staff, 'GET', '')).body.error).toBe('AI_QC_REAL_DATA_TENANT_NOT_APPROVED');
        expect((await (await build()).call(noAccess, 'GET', '')).status).toBe(403);
    });
    it('opening a customer saves a reference only and returns stats + messages (deleted messages hidden)', async () => {
        const { repo, call } = await build();
        const r = await call(staff, 'POST', '/' + C1);
        expect(r.status).toBe(200);
        expect(r.body.customer).toMatchObject({ contactId: C1, name: 'Chị Lan', conversations: 1 });
        expect(r.body.messages.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3']);
        expect(r.body.messages[0]).toMatchObject({ from: 'CUSTOMER', text: 'Chào shop', account: 'Zalo Sale 1' });
        expect(r.body.stats).toMatchObject({ total: 3, customer: 2, ours: 1, truncated: false });
        const state = await repo.read(ORG);
        expect(state.customerArchive).toEqual([expect.objectContaining({ contactId: C1, savedBy: staff.id, openCount: 1 })]);
        expect(JSON.stringify(state.customerArchive)).not.toContain('Chào shop');
        expect(state.audits.at(-1)).toMatchObject({ action: 'CUSTOMER_ARCHIVE_SAVED' });
        await call(staff, 'POST', '/' + C1);
        expect((await repo.read(ORG)).customerArchive![0]!.openCount).toBe(2);
        const list = await call(staff, 'GET', '');
        expect(list.body.items).toEqual([expect.objectContaining({ contactId: C1, name: 'Chị Lan', customerMessages: 2, ourMessages: 1, savedByMe: true })]);
    });
    it('a customer whose conversations the actor may not open is a 404 and is never saved or listed', async () => {
        const { repo, call } = await build();
        expect((await call(staff, 'POST', '/' + C2)).status).toBe(404);
        expect((await call(staff, 'GET', '/' + C2)).status).toBe(404);
        expect((await call(staff, 'GET', '/not-a-uuid')).status).toBe(404);
        expect((await repo.read(ORG)).customerArchive ?? []).toEqual([]);
        expect((await call(staff, 'GET', '/search?q=')).body.customers).toEqual([{ contactId: C1, name: 'Chị Lan', lastMessageAt: '2026-11-10T03:00:00.000Z', saved: false }]);
    });
    it('only the person who saved (or an approver) can remove a customer from the archive; CRM messages stay', async () => {
        const { repo, call } = await build();
        await call(staff, 'POST', '/' + C1);
        expect((await call(other, 'DELETE', '/' + C1)).status).toBe(403);
        expect((await call(staff, 'DELETE', '/' + C1)).body).toEqual({ removed: true });
        expect((await repo.read(ORG)).customerArchive).toEqual([]);
        expect(db.messages).toHaveLength(5);
    });
    it('pages older messages with ?before', async () => {
        const { call } = await build();
        const r = await call(staff, 'GET', `/${C1}?before=2026-11-10T02:05:00.000Z`);
        expect(r.body).toEqual({ messages: [expect.objectContaining({ id: 'm1' }), expect.objectContaining({ id: 'm2' })], hasMore: false });
    });
});
