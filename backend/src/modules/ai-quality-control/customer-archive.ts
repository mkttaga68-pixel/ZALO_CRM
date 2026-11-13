/**
 * Lưu trữ tin nhắn khách hàng (thay trang "Huấn luyện").
 *
 * Khi nhân viên mở một khách hàng, khách đó được LƯU vào danh sách lưu trữ của tổ chức (chỉ lưu tham chiếu:
 * contactId, người lưu, thời điểm). Nội dung tin nhắn KHÔNG được chép sang workspace AIQC: CRM đã lưu bền vững
 * trong bảng messages, trang này đọc trực tiếp từ đó và thống kê lại.
 *
 * Quyền: mọi truy cập đi qua cùng bộ kiểm tra như phân tích hội thoại CRM (quyền tài khoản Zalo, chế độ riêng tư,
 * policy conversation.view / contact.view, phạm vi khách hàng). Không có model AI nào nhận dữ liệu này.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { demand, QcError, type Action, type Actor, type WorkspaceRepository } from './contracts.js';
import { audit } from './knowledge.js';
import { mutateWithRetry } from './learning-drafts.js';

export interface CustomerArchiveEntry { contactId: string; savedBy: string; savedAt: string; lastOpenedAt: string; openCount: number }
export const CUSTOMER_ARCHIVE_LIMITS = { entries: 1000, listed: 100, searchResults: 30, conversationsPerCustomer: 50, messagePage: 100, statsCap: 50000 } as const;
/** Việt Nam không có giờ mùa hè: UTC+7 cố định cho thống kê theo giờ/ngày/tháng. */
const VN_OFFSET = 7 * 3600000;
const local = (d: Date) => new Date(d.getTime() + VN_OFFSET);
const pad = (n: number) => String(n).padStart(2, '0');
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };
const contactName = (c: { crmName: string | null; fullName: string | null; zaloUsername: string | null } | null) => (c?.crmName || c?.fullName || c?.zaloUsername || 'Khách chưa có tên').slice(0, 120);
const isNotFound = (e: unknown) => e instanceof QcError && e.statusCode === 404;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CustomerArchiveDeps {
    repo: WorkspaceRepository;
    actor: (request: FastifyRequest) => Promise<Actor>;
    enabled: () => boolean;
    unavailableReason?: string;
    /** Same gate as other CRM reads of this module (real-data pilot tenant). */
    realData: () => boolean;
    realDataOrgId?: string;
    /** CRM permission check for one conversation (throws 404 QcError when the actor may not open it). */
    authorize?: (actor: Actor, conversationId: string, request: FastifyRequest) => Promise<unknown>;
}

type MessageRow = { sentAt: Date; senderType: string; contentType: string; sentVia: string; conversationId: string };

/** Pure statistics over one customer's messages (exported for tests). */
export function customerMessageStats(rows: MessageRow[], accounts: Record<string, string>, now = new Date()) {
    const sorted = [...rows].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const customer = sorted.filter(r => r.senderType === 'contact'), ours = sorted.filter(r => r.senderType !== 'contact');
    const byType: Record<string, number> = {};
    for (const r of customer) byType[r.contentType || 'text'] = (byType[r.contentType || 'text'] ?? 0) + 1;
    const byHour = Array.from({ length: 24 }, () => 0), byWeekday = Array.from({ length: 7 }, () => 0), days = new Set<string>();
    for (const r of customer) { const l = local(r.sentAt); byHour[l.getUTCHours()]!++; byWeekday[l.getUTCDay()]!++; days.add(l.toISOString().slice(0, 10)); }
    // 12 tháng gần nhất (giờ Việt Nam), kể cả tháng không có tin.
    const months: Array<{ month: string; customer: number; ours: number }> = [], ln = local(now);
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(ln.getUTCFullYear(), ln.getUTCMonth() - i, 1)); months.push({ month: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`, customer: 0, ours: 0 }); }
    const monthIndex = new Map(months.map((m, i) => [m.month, i]));
    for (const r of sorted) { const l = local(r.sentAt), i = monthIndex.get(`${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}`); if (i !== undefined) r.senderType === 'contact' ? months[i]!.customer++ : months[i]!.ours++; }
    // Thời gian phản hồi: mỗi lượt khách nhắn (chuỗi tin liên tiếp của khách) → tin đầu tiên của nhân viên (không tính bot) sau đó, cùng hội thoại.
    const replies: number[] = []; let unanswered = 0;
    const byConversation = new Map<string, MessageRow[]>();
    for (const r of sorted) { const list = byConversation.get(r.conversationId) ?? []; list.push(r); byConversation.set(r.conversationId, list); }
    for (const list of byConversation.values()) {
        let waitingSince: number | null = null;
        for (const r of list) {
            if (r.senderType === 'contact') { if (waitingSince === null) waitingSince = r.sentAt.getTime(); }
            else if (waitingSince !== null && r.sentVia !== 'automation') { replies.push(Math.max(0, Math.round((r.sentAt.getTime() - waitingSince) / 1000))); waitingSince = null; }
        }
        if (waitingSince !== null) unanswered++;
    }
    const byAccount = [...byConversation.entries()].map(([id, list]) => ({ account: accounts[id] ?? 'Tài khoản Zalo', customer: list.filter(r => r.senderType === 'contact').length, ours: list.filter(r => r.senderType !== 'contact').length }))
        .sort((a, b) => b.customer + b.ours - a.customer - a.ours);
    return {
        total: sorted.length, customer: customer.length, ours: ours.length, automation: ours.filter(r => r.sentVia === 'automation').length,
        firstAt: sorted[0]?.sentAt.toISOString() ?? null, lastAt: sorted.at(-1)?.sentAt.toISOString() ?? null,
        firstCustomerAt: customer[0]?.sentAt.toISOString() ?? null, lastCustomerAt: customer.at(-1)?.sentAt.toISOString() ?? null,
        activeDays: days.size, byType, byHour, byWeekday, byMonth: months, byAccount,
        reply: { count: replies.length, unanswered, medianSeconds: median(replies), within5Minutes: replies.filter(s => s <= 300).length },
    };
}

export async function registerCustomerArchiveRoutes(app: FastifyInstance, deps: CustomerArchiveDeps) {
    const prefix = '/api/v1/ai-quality-control/customer-archive';
    const run = (action: Action, fn: (actor: Actor, request: FastifyRequest) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            if (!deps.enabled()) throw new QcError('AI_QC_DISABLED', 503);
            const actor = await deps.actor(request);
            demand(actor, action);
            if (deps.unavailableReason) throw new QcError(deps.unavailableReason, 503);
            if (!deps.realData() || !deps.authorize) throw new QcError('AI_QC_REAL_DATA_DISABLED', 403);
            if (actor.orgId !== deps.realDataOrgId) throw new QcError('AI_QC_REAL_DATA_TENANT_NOT_APPROVED', 403);
            return await fn(actor, request);
        }
        catch (error) {
            const known = error instanceof QcError;
            return reply.code(known ? error.statusCode : 503).send({ error: known ? error.code : 'AI_QC_STORAGE_OR_SERVICE_UNAVAILABLE' });
        }
    };
    const contactId = (r: FastifyRequest) => { const id = (r.params as { contactId?: string }).contactId ?? ''; if (!UUID.test(id)) throw new QcError('CUSTOMER_NOT_FOUND', 404); return id; };

    /** Conversations (1-1) of a customer that the actor may open in the CRM. Empty → 404 (no existence oracle). */
    async function allowedConversations(actor: Actor, id: string, request: FastifyRequest) {
        const conversations = await prisma.conversation.findMany({ where: { orgId: actor.orgId, contactId: id, threadType: 'user' }, orderBy: { lastMessageAt: 'desc' }, take: CUSTOMER_ARCHIVE_LIMITS.conversationsPerCustomer,
            select: { id: true, lastMessageAt: true, zaloAccount: { select: { displayName: true } } } });
        const allowed: typeof conversations = [];
        for (const c of conversations) {
            try { await deps.authorize!(actor, c.id, request); allowed.push(c); }
            catch (error) { if (!isNotFound(error)) throw error; }
        }
        if (!allowed.length) throw new QcError('CUSTOMER_NOT_FOUND', 404);
        return allowed;
    }
    /** Zalo accounts the actor may read (same rule as the CRM adapter). null = all accounts of the tenant. */
    async function readableAccounts(actor: Actor, request: FastifyRequest) {
        if (['owner', 'admin'].includes(request.user.role)) return null;
        const [owned, shared] = await Promise.all([
            prisma.zaloAccount.findMany({ where: { orgId: actor.orgId, ownerUserId: actor.id }, select: { id: true } }),
            prisma.zaloAccountAccess.findMany({ where: { userId: actor.id }, select: { zaloAccountId: true } })]);
        return [...new Set([...owned.map(a => a.id), ...shared.map(a => a.zaloAccountId)])];
    }
    async function counts(conversationIds: string[]) {
        if (!conversationIds.length) return new Map<string, { customer: number; ours: number }>();
        const groups = await prisma.message.groupBy({ by: ['conversationId', 'senderType'], where: { conversationId: { in: conversationIds }, isDeleted: false }, _count: { _all: true } });
        const map = new Map<string, { customer: number; ours: number }>();
        for (const g of groups) { const c = map.get(g.conversationId) ?? { customer: 0, ours: 0 }; g.senderType === 'contact' ? c.customer += g._count._all : c.ours += g._count._all; map.set(g.conversationId, c); }
        return map;
    }

    // Tìm khách hàng (chỉ khách có hội thoại 1-1 mà người dùng được phép mở).
    app.get(prefix + '/search', run('access', async (actor, request) => {
        const term = String((request.query as Record<string, unknown>)?.q ?? '').trim().slice(0, 80);
        const accounts = await readableAccounts(actor, request);
        if (accounts && !accounts.length) return { customers: [] };
        const scope = await (app as FastifyInstance & { scope: { resolve(kind: string, userId: string, orgId: string): Promise<unknown> } }).scope.resolve('contact', actor.id, actor.orgId);
        const contactWhere: Prisma.ContactWhereInput = { AND: [{ orgId: actor.orgId, mergedInto: null }, (scope ?? {}) as Prisma.ContactWhereInput,
            ...(term ? [{ OR: [{ crmName: { contains: term, mode: 'insensitive' as const } }, { fullName: { contains: term, mode: 'insensitive' as const } }, { zaloUsername: { contains: term, mode: 'insensitive' as const } }, { phone: { contains: term } }, { phoneNormalized: { contains: term.replace(/\D/g, '') || term } }] }] : [])] };
        const rows = await prisma.conversation.findMany({ where: { orgId: actor.orgId, threadType: 'user', contactId: { not: null }, zaloAccount: { orgId: actor.orgId, archivedAt: null, ...(accounts ? { id: { in: accounts } } : {}) }, contact: contactWhere },
            orderBy: { lastMessageAt: 'desc' }, take: 150, select: { id: true, contactId: true, lastMessageAt: true, contact: { select: { crmName: true, fullName: true, zaloUsername: true } } } });
        const state = await deps.repo.read(actor.orgId), saved = new Set((state.customerArchive ?? []).map(e => e.contactId));
        const customers: Array<{ contactId: string; name: string; lastMessageAt: string | null; saved: boolean }> = [], seen = new Set<string>();
        for (const r of rows) {
            if (customers.length >= CUSTOMER_ARCHIVE_LIMITS.searchResults) break;
            if (!r.contactId || seen.has(r.contactId)) continue;
            try { await deps.authorize!(actor, r.id, request); }
            catch (error) { if (isNotFound(error)) continue; throw error; }
            seen.add(r.contactId);
            customers.push({ contactId: r.contactId, name: contactName(r.contact), lastMessageAt: r.lastMessageAt?.toISOString() ?? null, saved: saved.has(r.contactId) });
        }
        return { customers };
    }));

    // Danh sách khách đã lưu (chỉ những khách người dùng hiện vẫn được phép xem).
    app.get(prefix, run('access', async (actor, request) => {
        const state = await deps.repo.read(actor.orgId);
        const entries = [...(state.customerArchive ?? [])].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)).slice(0, CUSTOMER_ARCHIVE_LIMITS.listed);
        const visible: Array<{ entry: CustomerArchiveEntry; conversations: string[] }> = [];
        for (const entry of entries) {
            try { visible.push({ entry, conversations: (await allowedConversations(actor, entry.contactId, request)).map(c => c.id) }); }
            catch (error) { if (!isNotFound(error)) throw error; }
        }
        const [contacts, totals] = await Promise.all([
            prisma.contact.findMany({ where: { orgId: actor.orgId, id: { in: visible.map(v => v.entry.contactId) } }, select: { id: true, crmName: true, fullName: true, zaloUsername: true, lastActivity: true } }),
            counts(visible.flatMap(v => v.conversations))]);
        const byId = new Map(contacts.map(c => [c.id, c]));
        return { items: visible.map(({ entry, conversations }) => {
            const sum = conversations.reduce((acc, id) => { const c = totals.get(id); return c ? { customer: acc.customer + c.customer, ours: acc.ours + c.ours } : acc; }, { customer: 0, ours: 0 });
            return { contactId: entry.contactId, name: contactName(byId.get(entry.contactId) ?? null), savedAt: entry.savedAt, lastOpenedAt: entry.lastOpenedAt, openCount: entry.openCount, savedByMe: entry.savedBy === actor.id,
                customerMessages: sum.customer, ourMessages: sum.ours, lastActivity: byId.get(entry.contactId)?.lastActivity?.toISOString() ?? null };
        }), limit: CUSTOMER_ARCHIVE_LIMITS.entries };
    }));

    // Mở khách hàng: lưu vào danh sách lưu trữ + trả về thống kê và trang tin nhắn mới nhất.
    app.post(prefix + '/:contactId', run('access', async (actor, request) => {
        const id = contactId(request);
        await allowedConversations(actor, id, request);
        const at = new Date().toISOString();
        await mutateWithRetry(deps.repo, actor.orgId, state => {
            const list = (state.customerArchive ??= []);
            const existing = list.find(e => e.contactId === id);
            if (existing) { existing.lastOpenedAt = at; existing.openCount++; return; }
            list.push({ contactId: id, savedBy: actor.id, savedAt: at, lastOpenedAt: at, openCount: 1 });
            if (list.length > CUSTOMER_ARCHIVE_LIMITS.entries) { list.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt)); list.length = CUSTOMER_ARCHIVE_LIMITS.entries; }
            audit(state, actor, 'CUSTOMER_ARCHIVE_SAVED', id);
        });
        return detail(actor, id, request, null);
    }));

    // Chi tiết (thống kê + tin nhắn). `before` = phân trang tin cũ hơn.
    app.get(prefix + '/:contactId', run('access', async (actor, request) => {
        const before = String((request.query as Record<string, unknown>)?.before ?? '');
        const beforeDate = before && Number.isFinite(Date.parse(before)) ? new Date(before) : null;
        return detail(actor, contactId(request), request, beforeDate);
    }));

    // Bỏ khỏi danh sách lưu trữ (không xoá tin nhắn trong CRM). Người đã lưu hoặc người có quyền duyệt.
    app.delete(prefix + '/:contactId', run('access', async (actor, request) => {
        const id = contactId(request);
        await allowedConversations(actor, id, request);
        return mutateWithRetry(deps.repo, actor.orgId, state => {
            const list = state.customerArchive ?? [], index = list.findIndex(e => e.contactId === id);
            if (index < 0) throw new QcError('CUSTOMER_NOT_FOUND', 404);
            if (list[index]!.savedBy !== actor.id && !actor.permissions.includes('approve')) throw new QcError('FORBIDDEN', 403);
            list.splice(index, 1);
            audit(state, actor, 'CUSTOMER_ARCHIVE_REMOVED', id);
            return { removed: true };
        });
    }));

    async function detail(actor: Actor, id: string, request: FastifyRequest, before: Date | null) {
        const conversations = await allowedConversations(actor, id, request), ids = conversations.map(c => c.id);
        const accounts = Object.fromEntries(conversations.map(c => [c.id, c.zaloAccount?.displayName || 'Tài khoản Zalo']));
        const rows = await prisma.message.findMany({ where: { conversationId: { in: ids }, isDeleted: false, ...(before ? { sentAt: { lt: before } } : {}) }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: CUSTOMER_ARCHIVE_LIMITS.messagePage + 1,
            select: { id: true, content: true, contentType: true, senderType: true, senderName: true, sentAt: true, sentVia: true, conversationId: true } });
        const hasMore = rows.length > CUSTOMER_ARCHIVE_LIMITS.messagePage;
        const messages = rows.slice(0, CUSTOMER_ARCHIVE_LIMITS.messagePage).reverse().map(m => ({ id: m.id, at: m.sentAt.toISOString(), from: m.senderType === 'contact' ? 'CUSTOMER' as const : 'US' as const,
            via: m.sentVia, type: m.contentType, text: (m.content ?? '').slice(0, 4000), sender: m.senderType === 'contact' ? null : (m.senderName ?? null), account: accounts[m.conversationId] ?? null }));
        if (before) return { messages, hasMore };
        const [contact, statRows, state] = await Promise.all([
            prisma.contact.findFirst({ where: { id, orgId: actor.orgId }, select: { crmName: true, fullName: true, zaloUsername: true, firstContactDate: true } }),
            prisma.message.findMany({ where: { conversationId: { in: ids }, isDeleted: false }, orderBy: { sentAt: 'desc' }, take: CUSTOMER_ARCHIVE_LIMITS.statsCap, select: { sentAt: true, senderType: true, contentType: true, sentVia: true, conversationId: true } }),
            deps.repo.read(actor.orgId)]);
        const entry = (state.customerArchive ?? []).find(e => e.contactId === id) ?? null;
        return { customer: { contactId: id, name: contactName(contact), firstContactDate: contact?.firstContactDate?.toISOString() ?? null, conversations: conversations.length },
            archive: entry ? { savedAt: entry.savedAt, lastOpenedAt: entry.lastOpenedAt, openCount: entry.openCount } : null,
            stats: { ...customerMessageStats(statRows, accounts), truncated: statRows.length >= CUSTOMER_ARCHIVE_LIMITS.statsCap },
            messages, hasMore };
    }
}
