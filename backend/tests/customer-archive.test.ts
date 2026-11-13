/**
 * "Lưu trữ tin nhắn": job đêm tự lưu tin 1-1, tìm theo tên/SĐT, quyền xem, thống kê.
 * Prisma được thay bằng bảng giả trong bộ nhớ — không chạm DB thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { QcError, type Actor } from '../src/modules/ai-quality-control/contracts.js';

type Row = Record<string, any>;
const db = vi.hoisted(() => ({ conversations: [] as Row[], messages: [] as Row[], contacts: [] as Row[], archive: [] as Row[], runs: [] as Row[] }));
vi.mock('../src/shared/database/prisma-client.js', async () => {
    const { Prisma } = await import('@prisma/client');
    // Generic matcher for the where-shapes used by the module.
    const match = (row: Row | undefined, where: any): boolean => {
        if (!where) return true;
        return Object.entries(where).every(([key, cond]: [string, any]) => {
            if (key === 'AND') return (cond as any[]).every(c => match(row, c));
            if (key === 'OR') return (cond as any[]).some(c => match(row, c));
            const value = row?.[key];
            if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
                if ('in' in cond) return cond.in.includes(value);
                if ('not' in cond) return cond.not === null ? value != null : value !== cond.not;
                if ('contains' in cond) return typeof value === 'string' && (cond.mode === 'insensitive' ? value.toLowerCase().includes(String(cond.contains).toLowerCase()) : value.includes(cond.contains));
                if ('lt' in cond || 'gt' in cond || 'lte' in cond) return (cond.lt === undefined || value < cond.lt) && (cond.gt === undefined || value > cond.gt) && (cond.lte === undefined || value <= cond.lte);
                return match(value, cond); // nested relation filter
            }
            return value === cond;
        });
    };
    const sortBy = (rows: Row[], orderBy: any) => { const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((o: Row) => Object.entries(o)[0]!);
        return [...rows].sort((a, b) => { for (const [k, dir] of keys) { const x = a[k], y = b[k]; if (x < y) return dir === 'asc' ? -1 : 1; if (x > y) return dir === 'asc' ? 1 : -1; } return 0; }); };
    const pick = (row: Row, select: any): Row => { if (!select) return { ...row }; const out: Row = {}; for (const [k, v] of Object.entries(select)) out[k] = v && typeof v === 'object' && 'select' in (v as Row) ? (row[k] ? pick(row[k], (v as Row).select) : null) : row[k]; return out; };
    const groupBy = (rows: Row[], args: any) => {
        const groups = new Map<string, Row[]>();
        for (const r of rows.filter(r => match(r, args.where))) { const key = JSON.stringify(args.by.map((k: string) => r[k])); groups.set(key, [...(groups.get(key) ?? []), r]); }
        let out = [...groups.values()].map(list => ({ ...Object.fromEntries(args.by.map((k: string) => [k, list[0]![k]])), ...(args._count ? { _count: { _all: list.length } } : {}),
            ...(args._max ? { _max: Object.fromEntries(Object.keys(args._max).map(k => [k, list.map(r => r[k]).sort().at(-1) ?? null])) } : {}) }));
        if (args.orderBy?._max) { const [k, dir] = Object.entries(args.orderBy._max)[0]! as [string, string]; out.sort((a: Row, b: Row) => (a._max[k] < b._max[k] ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
        return args.take ? out.slice(0, args.take) : out;
    };
    const withConversation = (m: Row) => ({ ...m, conversation: { ...db.conversations.find(c => c.id === m.conversationId), zaloAccount: { displayName: db.conversations.find(c => c.id === m.conversationId)?.accountName } } });
    return { prisma: {
        message: { findMany: async (a: any) => sortBy(db.messages.map(withConversation).filter(m => match(m, a.where)), a.orderBy).slice(a.skip ?? 0, (a.skip ?? 0) + a.take).map(r => pick(r, a.select)) },
        contact: { findMany: async (a: any) => db.contacts.filter(c => match(c, a.where)).slice(0, a.take ?? 1e9).map(r => pick(r, a.select)), findFirst: async (a: any) => { const r = db.contacts.find(c => match(c, a.where)); return r ? pick(r, a.select) : null; } },
        aiQcCustomerMessageArchive: {
            createMany: async ({ data }: any) => { let count = 0; for (const d of data) if (!db.archive.some(r => r.messageId === d.messageId)) { db.archive.push({ archivedAt: new Date(), ...d }); count++; } return { count }; },
            findMany: async (a: any) => sortBy(db.archive.filter(r => match(r, a.where)), a.orderBy).slice(0, a.take).map(r => pick(r, a.select)),
            groupBy: async (a: any) => groupBy(db.archive, a),
            aggregate: async (a: any) => ({ _max: { archivedAt: db.archive.filter(r => match(r, a.where)).map(r => r.archivedAt).sort().at(-1) ?? null } }),
            count: async (a: any) => db.archive.filter(r => match(r, a.where)).length,
        },
        aiQcCustomerArchiveRun: {
            updateMany: async (a: any) => { const rows = db.runs.filter(r => match(r, a.where)); rows.forEach(r => Object.assign(r, a.data)); return { count: rows.length }; },
            findFirst: async (a: any) => sortBy(db.runs.filter(r => match(r, a.where)), a.orderBy)[0] ?? null,
            create: async ({ data }: any) => { if (data.trigger === 'SCHEDULE' && db.runs.some(r => r.orgId === data.orgId && r.trigger === 'SCHEDULE' && r.localDate === data.localDate))
                throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }); db.runs.push({ customers: 0, messages: 0, finishedAt: null, errorCode: null, ...data }); return data; },
            update: async (a: any) => { const r = db.runs.find(x => x.id === a.where.id)!; Object.assign(r, a.data); return r; },
        },
    } };
});
const { customerArchiveSchedule, customerMessageStats, registerCustomerArchiveRoutes, runCustomerArchive } = await import('../src/modules/ai-quality-control/customer-archive.js');

const ORG = 'org-A', C1 = '11111111-1111-4111-8111-111111111111', C2 = '22222222-2222-4222-8222-222222222222', C3 = '33333333-3333-4333-8333-333333333333';
const at = (iso: string) => new Date(iso);
const admin: Actor = { id: 'admin-1', orgId: ORG, departmentIds: [], permissions: ['access', 'approve', 'view_all'] };
const staff: Actor = { id: 'staff-1', orgId: ORG, departmentIds: [], permissions: ['access'] };
const noAccess: Actor = { id: 'nobody', orgId: ORG, departmentIds: [], permissions: [] };
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(a => a.close())); });
let seq = 0;
const msg = (conversationId: string, senderType: string, content: string, sentAt: string, extra: Row = {}) => ({ id: `m${++seq}`, conversationId, senderType, senderName: senderType === 'contact' ? null : 'Sale A', sentVia: 'user', contentType: 'text', content, sentAt: at(sentAt), createdAt: at(sentAt), isDeleted: false, ...extra });
beforeEach(() => {
    seq = 0;
    db.conversations = [
        { id: 'conv-1', orgId: ORG, contactId: C1, threadType: 'user', zaloAccountId: 'acc-1', accountName: 'Zalo Sale 1' },
        { id: 'conv-2', orgId: ORG, contactId: C2, threadType: 'user', zaloAccountId: 'acc-2', accountName: 'Zalo Sale 2' },
        { id: 'grp-1', orgId: ORG, contactId: C3, threadType: 'group', zaloAccountId: 'acc-1', accountName: 'Zalo Sale 1' },
        { id: 'conv-x', orgId: 'org-B', contactId: C3, threadType: 'user', zaloAccountId: 'acc-9', accountName: 'Org B' },
    ];
    db.contacts = [
        { id: C1, orgId: ORG, crmName: 'Chị Lan', fullName: null, zaloUsername: null, phone: '0912345678', phoneNormalized: '84912345678', firstContactDate: null },
        { id: C2, orgId: ORG, crmName: null, fullName: 'Anh Minh', zaloUsername: null, phone: '0987000111', phoneNormalized: '84987000111', firstContactDate: null },
        { id: C3, orgId: ORG, crmName: 'Nhóm', fullName: null, zaloUsername: null, phone: null, phoneNormalized: null, firstContactDate: null },
    ];
    db.messages = [
        msg('conv-1', 'contact', 'Chào shop', '2026-11-10T02:00:00Z'),
        msg('conv-1', 'self', 'Dạ em chào chị', '2026-11-10T02:03:00Z'),
        msg('conv-1', 'contact', '', '2026-11-10T02:10:00Z', { contentType: 'image' }),
        msg('conv-1', 'contact', 'tin đã thu hồi', '2026-11-10T02:11:00Z', { isDeleted: true }),
        msg('conv-2', 'contact', 'Tư vấn giúp anh', '2026-11-11T03:00:00Z'),
        msg('grp-1', 'contact', 'tin nhóm', '2026-11-11T03:00:00Z'),
        msg('conv-x', 'contact', 'tổ chức khác', '2026-11-11T03:00:00Z'),
    ];
    db.archive = []; db.runs = [];
});
async function build(options: { realData?: boolean; orgId?: string; denied?: string[] } = {}) {
    const app = Fastify({ logger: false }); apps.push(app);
    app.decorate('scope', { resolve: async () => ({}) });
    const actors: Record<string, Actor> = { [admin.id]: admin, [staff.id]: staff, [noAccess.id]: noAccess };
    await registerCustomerArchiveRoutes(app, { actor: async r => actors[String(r.headers['x-actor'])]!, enabled: () => true, realData: () => options.realData ?? true, realDataOrgId: options.orgId ?? ORG,
        authorize: async (_a, id) => { if ((options.denied ?? ['conv-2']).includes(id)) throw new QcError('CONVERSATION_NOT_FOUND', 404); }, env: { AI_QC_CUSTOMER_ARCHIVE_ENABLED: 'true' } });
    return async (a: Actor, method: 'GET' | 'POST', url: string) => { const r = await app.inject({ method, url: '/api/v1/ai-quality-control/customer-archive' + url, headers: { 'x-actor': a.id } }); return { status: r.statusCode, body: r.json() as Row }; };
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
        expect(s.byHour[9]).toBe(2);
        expect(s.byMonth.at(-1)).toEqual({ month: '2026-11', customer: 3, ours: 2 });
    });
});

describe('nightly archive job', () => {
    it('schedule defaults to 22:00 Asia/Ho_Chi_Minh and stays off unless enabled', () => {
        expect(customerArchiveSchedule({})).toEqual({ enabled: false, schedule: { hour: 22, minute: 0, timeZone: 'Asia/Ho_Chi_Minh' }, blockers: ['CUSTOMER_ARCHIVE_DISABLED'] });
        expect(customerArchiveSchedule({ AI_QC_CUSTOMER_ARCHIVE_ENABLED: 'true', AI_QC_CUSTOMER_ARCHIVE_SCHEDULE: '23:30' })).toMatchObject({ enabled: true, schedule: { hour: 23, minute: 30 } });
        expect(customerArchiveSchedule({ AI_QC_CUSTOMER_ARCHIVE_ENABLED: 'true', AI_QC_CUSTOMER_ARCHIVE_SCHEDULE: '25:00' }).blockers).toContain('CUSTOMER_ARCHIVE_SCHEDULE_INVALID');
    });
    it('copies only 1-1 customer messages of the tenant (no groups, no recalled messages, no other org)', async () => {
        const r = await runCustomerArchive(ORG, { trigger: 'SCHEDULE', localDate: '2026-11-11', now: at('2026-11-11T15:00:00Z') });
        expect(r).toMatchObject({ messages: 4, customers: 2, cursorFrom: null });
        expect(db.archive.map(a => a.content).sort()).toEqual(['', 'Chào shop', 'Dạ em chào chị', 'Tư vấn giúp anh']);
        expect(db.archive[0]).toMatchObject({ orgId: ORG, contactId: C1, zaloAccountName: 'Zalo Sale 1', runId: r.runId });
        expect(db.runs[0]).toMatchObject({ status: 'DONE', messages: 4, customers: 2 });
    });
    it('next night copies only new messages (overlap never duplicates) and runs once per local date', async () => {
        await runCustomerArchive(ORG, { trigger: 'SCHEDULE', localDate: '2026-11-11', now: at('2026-11-11T15:00:00Z') });
        db.messages.push(msg('conv-1', 'contact', 'Mai giao hàng nhé', '2026-11-12T09:00:00Z'));
        expect(await runCustomerArchive(ORG, { trigger: 'SCHEDULE', localDate: '2026-11-11', now: at('2026-11-11T16:00:00Z') })).toMatchObject({ skipped: 'ALREADY_RAN_FOR_LOCAL_DATE' });
        const r = await runCustomerArchive(ORG, { trigger: 'SCHEDULE', localDate: '2026-11-12', now: at('2026-11-12T15:00:00Z') });
        expect(r).toMatchObject({ messages: 1, customers: 1, cursorFrom: '2026-11-11T14:50:00.000Z' });
        expect(db.archive).toHaveLength(5);
    });
    it('a manual run is refused while another run is in progress; a stale run is closed as failed', async () => {
        db.runs.push({ id: 'old', orgId: ORG, status: 'RUNNING', trigger: 'SCHEDULE', localDate: 'x', startedAt: at('2026-11-12T14:59:00Z'), cursorTo: at('2026-11-12T14:59:00Z') });
        await expect(runCustomerArchive(ORG, { trigger: 'MANUAL', localDate: 'y', now: at('2026-11-12T15:00:00Z') })).rejects.toMatchObject({ code: 'CUSTOMER_ARCHIVE_RUN_IN_PROGRESS' });
        const r = await runCustomerArchive(ORG, { trigger: 'MANUAL', localDate: 'y', now: at('2026-11-12T16:00:00Z') });
        expect(db.runs.find(x => x.id === 'old')).toMatchObject({ status: 'FAILED', errorCode: 'STALE_RUN' });
        expect(r.messages).toBe(4);
    });
    it('archived messages survive deletion of the conversation in the CRM', async () => {
        await runCustomerArchive(ORG, { trigger: 'MANUAL', localDate: 'x', now: at('2026-11-12T15:00:00Z') });
        db.messages = db.messages.filter(m => m.conversationId !== 'conv-1'); db.conversations = db.conversations.filter(c => c.id !== 'conv-1');
        const call = await build();
        const r = await call(admin, 'GET', '/' + C1);
        expect(r.body.messages.map((m: Row) => m.text)).toEqual(['Chào shop', 'Dạ em chào chị', '']);
    });
});

describe('customer archive routes', () => {
    it('is closed unless real CRM data is enabled for this tenant; Lưu ngay needs approve + view_all', async () => {
        expect((await (await build({ realData: false }))(admin, 'GET', '/status')).body.error).toBe('AI_QC_REAL_DATA_DISABLED');
        expect((await (await build({ orgId: 'org-B' }))(admin, 'GET', '/status')).body.error).toBe('AI_QC_REAL_DATA_TENANT_NOT_APPROVED');
        const call = await build();
        expect((await call(noAccess, 'GET', '/search')).status).toBe(403);
        expect((await call(staff, 'POST', '/run')).status).toBe(403);
        expect((await call(admin, 'POST', '/run')).body).toMatchObject({ messages: 4, customers: 2 });
    });
    it('status shows the schedule, last run and totals (totals only for admins)', async () => {
        const call = await build();
        await call(admin, 'POST', '/run');
        const s = (await call(admin, 'GET', '/status')).body;
        expect(s).toMatchObject({ enabled: true, schedule: { hour: 22, minute: 0 }, lastRun: { status: 'DONE', trigger: 'MANUAL', messages: 4 }, totals: { messages: 4, customers: 2 }, canRunNow: true });
        expect((await call(staff, 'GET', '/status')).body).toMatchObject({ totals: null, canRunNow: false });
    });
    it('admin finds archived customers by name or phone (with or without leading 0); phone shown to admins only', async () => {
        const call = await build();
        await call(admin, 'POST', '/run');
        expect((await call(admin, 'GET', '/search?q=lan')).body.customers).toEqual([{ contactId: C1, name: 'Chị Lan', phone: '0912345678', customerMessages: 2, ourMessages: 1, lastMessageAt: '2026-11-10T02:10:00.000Z' }]);
        expect((await call(admin, 'GET', '/search?q=0987000')).body.customers.map((c: Row) => c.name)).toEqual(['Anh Minh']);
        expect((await call(admin, 'GET', '/search?q=987000')).body.customers.map((c: Row) => c.name)).toEqual(['Anh Minh']);
        expect((await call(admin, 'GET', '/search?q=Nhóm')).body.customers).toEqual([]);
        expect((await call(admin, 'GET', '/search')).body.customers.map((c: Row) => c.name)).toEqual(['Anh Minh', 'Chị Lan']);
    });
    it('staff only see customers whose conversations they may still open; others are a 404', async () => {
        const call = await build();
        await call(admin, 'POST', '/run');
        expect((await call(staff, 'GET', '/search')).body.customers).toEqual([expect.objectContaining({ contactId: C1, phone: null })]);
        expect((await call(staff, 'GET', '/search?q=minh')).body.customers).toEqual([]);
        expect((await call(staff, 'GET', '/' + C2)).status).toBe(404);
        expect((await call(staff, 'GET', '/not-a-uuid')).status).toBe(404);
        expect((await call(admin, 'GET', '/' + C2)).status).toBe(200);
    });
    it('detail returns archived messages, statistics and pages older messages', async () => {
        const call = await build();
        await call(admin, 'POST', '/run');
        const r = (await call(admin, 'GET', '/' + C1)).body;
        expect(r.customer).toMatchObject({ contactId: C1, name: 'Chị Lan', phone: '0912345678', conversations: 1 });
        expect(r.messages[0]).toMatchObject({ from: 'CUSTOMER', text: 'Chào shop', account: 'Zalo Sale 1' });
        expect(r.stats).toMatchObject({ total: 3, customer: 2, ours: 1, truncated: false });
        expect(r.archive.lastArchivedAt).toEqual(expect.any(String));
        expect((await call(admin, 'GET', `/${C1}?before=2026-11-10T02:05:00.000Z`)).body).toEqual({ messages: [expect.objectContaining({ text: 'Chào shop' }), expect.objectContaining({ text: 'Dạ em chào chị' })], hasMore: false });
    });
});
