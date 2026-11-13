/**
 * "Lưu trữ tin nhắn" — tự động lưu tin nhắn 1-1 của khách hàng mỗi đêm (mặc định 22:00 giờ Việt Nam).
 *
 * - Job đêm chép tin nhắn mới (kể từ lần lưu trước) của các hội thoại 1-1 sang bảng ai_qc_customer_message_archive.
 *   Bản lưu độc lập với hội thoại/tài khoản Zalo: xoá hội thoại hay tài khoản trong CRM không làm mất bản lưu.
 * - Admin tìm khách theo tên/số điện thoại và xem tin nhắn + thống kê đã lưu. Không cần thao tác lưu thủ công.
 * - Không có AI nào đọc dữ liệu này; đây là bản sao trong cùng database.
 *
 * Quyền: người có view_all (quản trị) xem mọi khách đã lưu của tổ chức. Người khác chỉ xem tin của các hội thoại
 * mà họ hiện vẫn được phép mở trong CRM (kiểm tra lại mỗi lần, qua CrmConversationReadAdapter.authorize).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { demand, QcError, type Action, type Actor } from './contracts.js';
import { localClock } from './learning-drafts.js';

export const CUSTOMER_ARCHIVE_LIMITS = { searchResults: 30, recent: 20, contactCandidates: 300, messagePage: 100, statsCap: 50000, batch: 1000, overlapMinutes: 10, staleRunMinutes: 30 } as const;
/** Việt Nam không có giờ mùa hè: UTC+7 cố định cho thống kê theo giờ/ngày/tháng. */
const VN_OFFSET = 7 * 3600000;
const local = (d: Date) => new Date(d.getTime() + VN_OFFSET);
const pad = (n: number) => String(n).padStart(2, '0');
const median = (values: number[]) => { if (!values.length) return null; const s = [...values].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2); };
const contactName = (c: { crmName: string | null; fullName: string | null; zaloUsername: string | null } | null | undefined) => (c?.crmName || c?.fullName || c?.zaloUsername || 'Khách chưa có tên').slice(0, 120);
const isNotFound = (e: unknown) => e instanceof QcError && e.statusCode === 404;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MessageRow = { sentAt: Date; senderType: string; contentType: string; sentVia: string; conversationId: string };

/** Pure statistics over one customer's messages (exported for tests). */
export function customerMessageStats(rows: MessageRow[], accounts: Record<string, string>, now = new Date()) {
    const sorted = [...rows].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const customer = sorted.filter(r => r.senderType === 'contact'), ours = sorted.filter(r => r.senderType !== 'contact');
    const byType: Record<string, number> = {};
    for (const r of customer) byType[r.contentType || 'text'] = (byType[r.contentType || 'text'] ?? 0) + 1;
    const byHour = Array.from({ length: 24 }, () => 0), byWeekday = Array.from({ length: 7 }, () => 0), days = new Set<string>();
    for (const r of customer) { const l = local(r.sentAt); byHour[l.getUTCHours()]!++; byWeekday[l.getUTCDay()]!++; days.add(l.toISOString().slice(0, 10)); }
    const months: Array<{ month: string; customer: number; ours: number }> = [], ln = local(now);
    for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(ln.getUTCFullYear(), ln.getUTCMonth() - i, 1)); months.push({ month: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`, customer: 0, ours: 0 }); }
    const monthIndex = new Map(months.map((m, i) => [m.month, i]));
    for (const r of sorted) { const l = local(r.sentAt), i = monthIndex.get(`${l.getUTCFullYear()}-${pad(l.getUTCMonth() + 1)}`); if (i !== undefined) r.senderType === 'contact' ? months[i]!.customer++ : months[i]!.ours++; }
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

/* ------------------------------------------------------------------ nightly job */

export interface ArchiveSchedule { hour: number; minute: number; timeZone: string }
/** AI_QC_CUSTOMER_ARCHIVE_ENABLED=true bật job; AI_QC_CUSTOMER_ARCHIVE_SCHEDULE=HH:MM (mặc định 22:00); AI_QC_CUSTOMER_ARCHIVE_TZ (mặc định Asia/Ho_Chi_Minh). */
export function customerArchiveSchedule(env: NodeJS.ProcessEnv): { enabled: boolean; schedule: ArchiveSchedule | null; blockers: string[] } {
    const blockers: string[] = [];
    if (env.AI_QC_CUSTOMER_ARCHIVE_ENABLED !== 'true') blockers.push('CUSTOMER_ARCHIVE_DISABLED');
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(env.AI_QC_CUSTOMER_ARCHIVE_SCHEDULE || '22:00');
    if (!m) blockers.push('CUSTOMER_ARCHIVE_SCHEDULE_INVALID');
    const timeZone = env.AI_QC_CUSTOMER_ARCHIVE_TZ || 'Asia/Ho_Chi_Minh';
    try { new Intl.DateTimeFormat('en-US', { timeZone }); } catch { blockers.push('CUSTOMER_ARCHIVE_TZ_INVALID'); }
    const schedule = m && !blockers.includes('CUSTOMER_ARCHIVE_TZ_INVALID') ? { hour: Number(m[1]), minute: Number(m[2]), timeZone } : null;
    return { enabled: !blockers.length, schedule, blockers };
}

export interface ArchiveRunResult { runId: string | null; skipped?: 'ALREADY_RAN_FOR_LOCAL_DATE' | 'RUN_IN_PROGRESS'; messages: number; customers: number; cursorFrom: string | null; cursorTo: string | null }

/**
 * Copies 1-1 customer messages created since the previous successful run (with a small overlap so late commits are
 * never missed; duplicates are skipped by the primary key). Deleted/recalled messages are not copied.
 */
export async function runCustomerArchive(orgId: string, input: { trigger: 'SCHEDULE' | 'MANUAL'; localDate: string; now?: Date }): Promise<ArchiveRunResult> {
    const now = input.now ?? new Date(), L = CUSTOMER_ARCHIVE_LIMITS;
    // A run that died mid-way (process restart) must not block the next ones forever.
    await prisma.aiQcCustomerArchiveRun.updateMany({ where: { orgId, status: 'RUNNING', startedAt: { lt: new Date(now.getTime() - L.staleRunMinutes * 60000) } }, data: { status: 'FAILED', errorCode: 'STALE_RUN', finishedAt: now } });
    if (await prisma.aiQcCustomerArchiveRun.findFirst({ where: { orgId, status: 'RUNNING' }, select: { id: true } })) {
        if (input.trigger === 'MANUAL') throw new QcError('CUSTOMER_ARCHIVE_RUN_IN_PROGRESS', 409);
        return { runId: null, skipped: 'RUN_IN_PROGRESS', messages: 0, customers: 0, cursorFrom: null, cursorTo: null };
    }
    const previous = await prisma.aiQcCustomerArchiveRun.findFirst({ where: { orgId, status: 'DONE' }, orderBy: { cursorTo: 'desc' }, select: { cursorTo: true } });
    const cursorFrom = previous ? new Date(previous.cursorTo.getTime() - L.overlapMinutes * 60000) : null, cursorTo = now, id = randomUUID();
    try { await prisma.aiQcCustomerArchiveRun.create({ data: { id, orgId, localDate: input.localDate, trigger: input.trigger, status: 'RUNNING', startedAt: now, cursorFrom, cursorTo } }); }
    catch (error) {
        if (input.trigger === 'SCHEDULE' && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            return { runId: null, skipped: 'ALREADY_RAN_FOR_LOCAL_DATE', messages: 0, customers: 0, cursorFrom: null, cursorTo: null };
        throw error;
    }
    try {
        let inserted = 0, skip = 0;
        const customers = new Set<string>();
        for (;;) {
            const rows = await prisma.message.findMany({
                where: { isDeleted: false, createdAt: { ...(cursorFrom ? { gt: cursorFrom } : {}), lte: cursorTo }, conversation: { orgId, threadType: 'user', contactId: { not: null } } },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip, take: L.batch,
                select: { id: true, senderType: true, senderName: true, sentVia: true, contentType: true, content: true, sentAt: true, conversationId: true,
                    conversation: { select: { contactId: true, zaloAccountId: true, zaloAccount: { select: { displayName: true } } } } },
            });
            if (!rows.length) break;
            const data = rows.filter(r => r.conversation.contactId).map(r => ({ messageId: r.id, orgId, contactId: r.conversation.contactId!, conversationId: r.conversationId, zaloAccountId: r.conversation.zaloAccountId,
                zaloAccountName: r.conversation.zaloAccount?.displayName ?? null, senderType: r.senderType, senderName: r.senderName, sentVia: r.sentVia, contentType: r.contentType, content: r.content, sentAt: r.sentAt, runId: id }));
            const { count } = await prisma.aiQcCustomerMessageArchive.createMany({ data, skipDuplicates: true });
            inserted += count;
            for (const d of data) customers.add(d.contactId);
            if (rows.length < L.batch) break;
            skip += rows.length;
        }
        await prisma.aiQcCustomerArchiveRun.update({ where: { id }, data: { status: 'DONE', finishedAt: new Date(), messages: inserted, customers: customers.size } });
        return { runId: id, messages: inserted, customers: customers.size, cursorFrom: cursorFrom?.toISOString() ?? null, cursorTo: cursorTo.toISOString() };
    }
    catch (error) {
        await prisma.aiQcCustomerArchiveRun.update({ where: { id }, data: { status: 'FAILED', finishedAt: new Date(), errorCode: error instanceof QcError ? error.code : 'CUSTOMER_ARCHIVE_FAILED' } }).catch(() => undefined);
        throw error;
    }
}

export function registerCustomerArchiveScheduler(app: FastifyInstance, options: { realDataOrgId?: string; env?: NodeJS.ProcessEnv }) {
    const env = options.env ?? process.env, gate = customerArchiveSchedule(env);
    if (!options.realDataOrgId) gate.blockers.push('REAL_DATA_TENANT_NOT_CONFIGURED');
    if (gate.blockers.length || !gate.schedule || !options.realDataOrgId) {
        app.log.info({ blockers: gate.blockers }, 'AIQC customer archive scheduler disabled');
        return { started: false, blockers: gate.blockers };
    }
    const schedule = gate.schedule, orgId = options.realDataOrgId;
    let running = false;
    const tick = async () => {
        const now = new Date(), clock = localClock(now, schedule.timeZone);
        if (running || clock.minutes < schedule.hour * 60 + schedule.minute) return;
        running = true;
        try {
            const r = await runCustomerArchive(orgId, { trigger: 'SCHEDULE', localDate: clock.date, now });
            if (r.skipped) app.log.debug({ skipped: r.skipped }, 'AIQC customer archive skipped');
            else app.log.info({ runId: r.runId, messages: r.messages, customers: r.customers }, 'AIQC customer archive completed');
        }
        catch (error) { app.log.error({ code: error instanceof QcError ? error.code : 'CUSTOMER_ARCHIVE_FAILED' }, 'AIQC customer archive failed'); }
        finally { running = false; }
    };
    const timer = setInterval(() => void tick(), 5 * 60000); timer.unref?.();
    app.addHook('onClose', async () => clearInterval(timer));
    void tick();
    app.log.info({ schedule }, 'AIQC customer archive scheduler started');
    return { started: true, blockers: [] as string[] };
}

/* ------------------------------------------------------------------ routes */

export interface CustomerArchiveDeps {
    actor: (request: FastifyRequest) => Promise<Actor>;
    enabled: () => boolean;
    unavailableReason?: string;
    /** Same gate as other CRM reads of this module (real-data pilot tenant). */
    realData: () => boolean;
    realDataOrgId?: string;
    /** CRM permission check for one conversation (throws 404 QcError when the actor may not open it). */
    authorize?: (actor: Actor, conversationId: string, request: FastifyRequest) => Promise<unknown>;
    env?: NodeJS.ProcessEnv;
}

export async function registerCustomerArchiveRoutes(app: FastifyInstance, deps: CustomerArchiveDeps) {
    const prefix = '/api/v1/ai-quality-control/customer-archive', L = CUSTOMER_ARCHIVE_LIMITS;
    const run = (actions: Action[], fn: (actor: Actor, request: FastifyRequest) => Promise<unknown>) => async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            if (!deps.enabled()) throw new QcError('AI_QC_DISABLED', 503);
            const actor = await deps.actor(request);
            for (const action of actions) demand(actor, action);
            if (deps.unavailableReason) throw new QcError(deps.unavailableReason, 503);
            if (!deps.realData() || !deps.authorize) throw new QcError('AI_QC_REAL_DATA_DISABLED', 403);
            if (actor.orgId !== deps.realDataOrgId) throw new QcError('AI_QC_REAL_DATA_TENANT_NOT_APPROVED', 403);
            return await fn(actor, request);
        }
        catch (error) {
            const known = error instanceof QcError;
            if (!known && error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022'))
                return reply.code(503).send({ error: 'CUSTOMER_ARCHIVE_SCHEMA_NOT_READY' });
            return reply.code(known ? error.statusCode : 503).send({ error: known ? error.code : 'AI_QC_STORAGE_OR_SERVICE_UNAVAILABLE' });
        }
    };
    const admin = (actor: Actor) => actor.permissions.includes('view_all');
    const contactId = (r: FastifyRequest) => { const id = (r.params as { contactId?: string }).contactId ?? ''; if (!UUID.test(id)) throw new QcError('CUSTOMER_NOT_FOUND', 404); return id; };

    /** Archived conversations of a customer the actor may read now. Admin: all. Others: re-checked against CRM permissions. */
    async function visibleConversations(actor: Actor, request: FastifyRequest, id: string) {
        const ids = (await prisma.aiQcCustomerMessageArchive.groupBy({ by: ['conversationId'], where: { orgId: actor.orgId, contactId: id } })).map(g => g.conversationId);
        if (admin(actor)) return ids;
        const allowed: string[] = [];
        for (const c of ids) {
            try { await deps.authorize!(actor, c, request); allowed.push(c); }
            catch (error) { if (!isNotFound(error)) throw error; }
        }
        return allowed;
    }
    /** Per-customer counts over the archive (only conversations the actor may read). */
    async function summaries(actor: Actor, request: FastifyRequest, contactIds: string[]) {
        if (!contactIds.length) return [];
        const groups = await prisma.aiQcCustomerMessageArchive.groupBy({ by: ['contactId', 'conversationId', 'senderType'], where: { orgId: actor.orgId, contactId: { in: contactIds } }, _count: { _all: true }, _max: { sentAt: true } });
        const allowed = new Map<string, boolean>();
        const out = new Map<string, { customerMessages: number; ourMessages: number; lastMessageAt: Date | null }>();
        for (const g of groups) {
            if (!admin(actor)) {
                if (!allowed.has(g.conversationId)) { try { await deps.authorize!(actor, g.conversationId, request); allowed.set(g.conversationId, true); } catch (error) { if (!isNotFound(error)) throw error; allowed.set(g.conversationId, false); } }
                if (!allowed.get(g.conversationId)) continue;
            }
            const s = out.get(g.contactId) ?? { customerMessages: 0, ourMessages: 0, lastMessageAt: null };
            g.senderType === 'contact' ? s.customerMessages += g._count._all : s.ourMessages += g._count._all;
            if (g._max.sentAt && (!s.lastMessageAt || g._max.sentAt > s.lastMessageAt)) s.lastMessageAt = g._max.sentAt;
            out.set(g.contactId, s);
        }
        const contacts = await prisma.contact.findMany({ where: { orgId: actor.orgId, id: { in: [...out.keys()] } }, select: { id: true, crmName: true, fullName: true, zaloUsername: true, phone: true } });
        const byId = new Map(contacts.map(c => [c.id, c]));
        return [...out.entries()].map(([id, s]) => ({ contactId: id, name: byId.has(id) ? contactName(byId.get(id)) : 'Khách không còn trong CRM', phone: admin(actor) ? byId.get(id)?.phone ?? null : null,
            customerMessages: s.customerMessages, ourMessages: s.ourMessages, lastMessageAt: s.lastMessageAt?.toISOString() ?? null }))
            .sort((a, b) => (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''));
    }

    // Trạng thái job đêm + lần lưu gần nhất.
    app.get(prefix + '/status', run(['access'], async (actor) => {
        const gate = customerArchiveSchedule(deps.env ?? process.env);
        const [last, lastDone] = await Promise.all([
            prisma.aiQcCustomerArchiveRun.findFirst({ where: { orgId: actor.orgId }, orderBy: { startedAt: 'desc' } }),
            prisma.aiQcCustomerArchiveRun.findFirst({ where: { orgId: actor.orgId, status: 'DONE' }, orderBy: { cursorTo: 'desc' } })]);
        const totals = admin(actor) ? { messages: await prisma.aiQcCustomerMessageArchive.count({ where: { orgId: actor.orgId } }), customers: (await prisma.aiQcCustomerMessageArchive.groupBy({ by: ['contactId'], where: { orgId: actor.orgId } })).length } : null;
        const view = (r: typeof last) => r ? { status: r.status, trigger: r.trigger, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, savedUntil: r.cursorTo.toISOString(), messages: r.messages, customers: r.customers, errorCode: r.errorCode } : null;
        return { enabled: gate.enabled, schedule: gate.schedule, blockers: gate.blockers, lastRun: view(last), lastSuccess: view(lastDone), totals, canRunNow: admin(actor) && actor.permissions.includes('approve') };
    }));

    // Lưu ngay (quản trị): dùng cho lần đầu hoặc khi cần dữ liệu trước giờ chạy đêm.
    app.post(prefix + '/run', run(['access', 'approve', 'view_all'], async (actor) => {
        const tz = customerArchiveSchedule(deps.env ?? process.env).schedule?.timeZone ?? 'Asia/Ho_Chi_Minh';
        return runCustomerArchive(actor.orgId, { trigger: 'MANUAL', localDate: localClock(new Date(), tz).date });
    }));

    // Tìm khách đã được lưu theo tên / số điện thoại. Không nhập gì: các khách có tin được lưu gần nhất.
    app.get(prefix + '/search', run(['access'], async (actor, request) => {
        const term = String((request.query as Record<string, unknown>)?.q ?? '').trim().slice(0, 80);
        if (!term) {
            const recent = await prisma.aiQcCustomerMessageArchive.groupBy({ by: ['contactId'], where: { orgId: actor.orgId }, _max: { sentAt: true }, orderBy: { _max: { sentAt: 'desc' } }, take: L.recent * 3 });
            return { customers: (await summaries(actor, request, recent.map(r => r.contactId))).slice(0, L.recent) };
        }
        const scope = await (app as FastifyInstance & { scope?: { resolve(kind: string, userId: string, orgId: string): Promise<unknown> } }).scope?.resolve('contact', actor.id, actor.orgId);
        const digits = term.replace(/\D/g, '');
        const candidates = await prisma.contact.findMany({ where: { AND: [{ orgId: actor.orgId }, (admin(actor) ? {} : scope ?? {}) as Prisma.ContactWhereInput, { OR: [
            { crmName: { contains: term, mode: 'insensitive' } }, { fullName: { contains: term, mode: 'insensitive' } }, { zaloUsername: { contains: term, mode: 'insensitive' } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }, { phoneNormalized: { contains: digits.replace(/^0/, '') } }] : []) ] }] }, select: { id: true }, take: L.contactCandidates });
        return { customers: (await summaries(actor, request, candidates.map(c => c.id))).slice(0, L.searchResults) };
    }));

    // Chi tiết khách: tin nhắn đã lưu + thống kê. `before` = phân trang tin cũ hơn.
    app.get(prefix + '/:contactId', run(['access'], async (actor, request) => {
        const id = contactId(request), conversations = await visibleConversations(actor, request, id);
        if (!conversations.length) throw new QcError('CUSTOMER_NOT_FOUND', 404);
        const before = String((request.query as Record<string, unknown>)?.before ?? ''), beforeDate = before && Number.isFinite(Date.parse(before)) ? new Date(before) : null;
        const where = { orgId: actor.orgId, contactId: id, conversationId: { in: conversations } };
        const rows = await prisma.aiQcCustomerMessageArchive.findMany({ where: { ...where, ...(beforeDate ? { sentAt: { lt: beforeDate } } : {}) }, orderBy: [{ sentAt: 'desc' }, { messageId: 'desc' }], take: L.messagePage + 1 });
        const hasMore = rows.length > L.messagePage;
        const messages = rows.slice(0, L.messagePage).reverse().map(m => ({ id: m.messageId, at: m.sentAt.toISOString(), from: m.senderType === 'contact' ? 'CUSTOMER' as const : 'US' as const,
            via: m.sentVia, type: m.contentType, text: (m.content ?? '').slice(0, 4000), sender: m.senderType === 'contact' ? null : m.senderName, account: m.zaloAccountName }));
        if (beforeDate) return { messages, hasMore };
        const [contact, statRows, lastArchived] = await Promise.all([
            prisma.contact.findFirst({ where: { id, orgId: actor.orgId }, select: { crmName: true, fullName: true, zaloUsername: true, phone: true, firstContactDate: true } }),
            prisma.aiQcCustomerMessageArchive.findMany({ where, orderBy: { sentAt: 'desc' }, take: L.statsCap, select: { sentAt: true, senderType: true, contentType: true, sentVia: true, conversationId: true, zaloAccountName: true } }),
            prisma.aiQcCustomerMessageArchive.aggregate({ where, _max: { archivedAt: true } })]);
        const accounts = Object.fromEntries(statRows.map(r => [r.conversationId, r.zaloAccountName || 'Tài khoản Zalo']));
        return { customer: { contactId: id, name: contact ? contactName(contact) : 'Khách không còn trong CRM', phone: admin(actor) ? contact?.phone ?? null : null,
                firstContactDate: contact?.firstContactDate?.toISOString() ?? null, conversations: conversations.length },
            archive: { lastArchivedAt: lastArchived._max.archivedAt?.toISOString() ?? null },
            stats: { ...customerMessageStats(statRows, accounts), truncated: statRows.length >= L.statsCap }, messages, hasMore };
    }));
}
