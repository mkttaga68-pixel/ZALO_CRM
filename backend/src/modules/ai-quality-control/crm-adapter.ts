import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { buildPrivacyContext, canSeeConversationContent } from '../privacy/redact.js';
import { QcError, type Actor, type Conversation, type Message } from './contracts.js';
/** Opt-in READ adapter only. Never runs with AI_QC_REAL_DATA_ENABLED=false. */
export class CrmConversationReadAdapter {
    constructor(private app: FastifyInstance, private enabled: () => boolean) { }
    /** Background context ends at the triggering message, never at the latest 50 chats. */
    async loadAt(actor:Actor,id:string,request:FastifyRequest,at:Date):Promise<Conversation>{
        await this.allowed(actor,id,request);
        const rows=await prisma.message.findMany({where:{conversationId:id,isDeleted:false,sentAt:{lte:at},conversation:{orgId:actor.orgId}},orderBy:[{sentAt:'desc'},{id:'desc'}],take:50,
            select:{id:true,content:true,sentAt:true,senderType:true,sentVia:true,repliedByUserId:true,repliedBy:{select:{orgId:true}}}});
        const messages:Message[]=rows.reverse().map(m=>{
            const role:Message['role']=m.senderType==='contact'?'CUSTOMER':m.sentVia==='automation'?'BOT':m.sentVia==='system'?'SYSTEM':m.senderType==='self'&&m.repliedByUserId&&m.repliedBy?.orgId===actor.orgId?'HUMAN':'UNKNOWN';
            return {id:m.id,text:(m.content??'').slice(0,4000),occurredAt:m.sentAt.toISOString(),role,actorId:role==='HUMAN'?m.repliedByUserId:null,attribution:role==='HUMAN'?'VERIFIED':'UNKNOWN',timestampStatus:m.sentAt.getTime()<=Date.now()+300000?'VERIFIED':'UNKNOWN'};
        });
        return {id,orgId:actor.orgId,source:'CRM',messages,departmentIds:[...actor.departmentIds],coverage:'UNKNOWN',assignedActorId:null,assignmentStatus:'UNKNOWN',workIntervals:null,offDayIntervals:null,observationEndAt:new Date().toISOString(),provenanceHash:null};
    }
    /** Public view of the CRM permission check (account access, privacy, policies, contact scope). Throws 404 QcError when denied. */
    async authorize(actor: Actor, id: string, request: FastifyRequest) { await this.allowed(actor, id, request); }
    private async allowed(actor: Actor, id: string, request: FastifyRequest) {
        if (!this.enabled())
            throw new QcError('AI_QC_REAL_DATA_DISABLED', 403);
        const conv = await prisma.conversation.findFirst({ where: { id, orgId: actor.orgId, zaloAccount: { orgId: actor.orgId, archivedAt: null } }, include: { zaloAccount: { select: { id: true, ownerUserId: true, privacyMode: true } } } });
        if (!conv)
            throw new QcError('CONVERSATION_NOT_FOUND', 404);
        if (!['owner', 'admin'].includes(request.user.role) && conv.zaloAccount.ownerUserId !== actor.id && !await prisma.zaloAccountAccess.findFirst({ where: { userId: actor.id, zaloAccountId: conv.zaloAccountId }, select: { id: true } }))
            throw new QcError('CONVERSATION_NOT_FOUND', 404);
        if (!canSeeConversationContent(conv, await buildPrivacyContext(request)) || !await this.app.policy.check('conversation.view', { req: request, userId: actor.id, orgId: actor.orgId, resourceId: id }))
            throw new QcError('CONVERSATION_NOT_FOUND', 404);
        if (conv.contactId) {
            const scope = await this.app.scope.resolve('contact', actor.id, actor.orgId);
            if (!await prisma.contact.findFirst({ where: { AND: [{ id: conv.contactId, orgId: actor.orgId }, (scope ?? {}) as Prisma.ContactWhereInput] }, select: { id: true } }) || !await this.app.policy.check('contact.view', { req: request, userId: actor.id, orgId: actor.orgId, resourceId: conv.contactId }))
                throw new QcError('CONVERSATION_NOT_FOUND', 404);
        }
        return conv;
    }
    async list(actor: Actor, request: FastifyRequest) {
        if (!this.enabled())
            throw new QcError('AI_QC_REAL_DATA_DISABLED', 403);
        const ids = await prisma.conversation.findMany({ where: { orgId: actor.orgId }, select: { id: true }, orderBy: { lastMessageAt: 'desc' }, take: 50 });
        const conversations = [];
        for (const row of ids)
            try {
                const c = await this.allowed(actor, row.id, request);
                // Display metadata only for conversations the actor may already open in the CRM. Never sent to the model.
                const meta = await prisma.conversation.findFirst({ where: { id: c.id, orgId: actor.orgId }, select: { threadType: true, groupName: true, lastMessageAt: true, zaloAccount: { select: { displayName: true } }, contact: { select: { fullName: true, zaloUsername: true } } } });
                const friend = c.contactId ? await prisma.friend.findFirst({ where: { orgId: actor.orgId, contactId: c.contactId, zaloAccountId: c.zaloAccountId }, select: { aliasInNick: true, zaloDisplayName: true } }) : null;
                const group = meta?.threadType === 'group';
                const title = (group ? meta?.groupName : friend?.aliasInNick || friend?.zaloDisplayName || meta?.contact?.fullName || meta?.contact?.zaloUsername) || (group ? 'Nhóm chưa có tên' : 'Khách chưa có tên');
                conversations.push({ id: c.id, title: title.slice(0, 120), kind: group ? 'GROUP' : 'USER', zaloAccount: meta?.zaloAccount?.displayName ?? null, lastMessageAt: meta?.lastMessageAt?.toISOString() ?? null, source: 'CRM' });
            }
            catch (error) {
                if (!(error instanceof QcError && error.statusCode === 404))
                    throw error;
            }
        return { conversations, coverage: 'LIMITED_TO_50_CANDIDATES_NOT_FULL_HISTORY' };
    }
    async load(actor: Actor, id: string, request: FastifyRequest): Promise<Conversation> {
        await this.allowed(actor, id, request);
        const rows = await prisma.message.findMany({ where: { conversationId: id, isDeleted: false, conversation: { orgId: actor.orgId } }, orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], take: 200,
            select: { id: true, content: true, sentAt: true, senderType: true, sentVia: true, repliedByUserId: true, repliedBy: { select: { orgId: true } } } });
        const messages: Message[] = rows.reverse().map(m => {
            const role: Message['role'] = m.senderType === 'contact' ? 'CUSTOMER' : m.sentVia === 'automation' ? 'BOT' : m.sentVia === 'system' ? 'SYSTEM' : m.senderType === 'self' && m.repliedByUserId && m.repliedBy?.orgId === actor.orgId ? 'HUMAN' : 'UNKNOWN';
            return { id: m.id, text: (m.content ?? '').slice(0, 4000), occurredAt: m.sentAt.toISOString(), role, actorId: role === 'HUMAN' ? m.repliedByUserId : null, attribution: role === 'HUMAN' ? 'VERIFIED' : 'UNKNOWN', timestampStatus: Number.isFinite(m.sentAt.getTime()) && m.sentAt.getTime() <= Date.now() + 300000 ? 'VERIFIED' : 'UNKNOWN' };
        });
        return { id, orgId: actor.orgId, source: 'CRM', messages, departmentIds: [...actor.departmentIds], coverage: 'UNKNOWN', assignedActorId: null, assignmentStatus: 'UNKNOWN', workIntervals: null, offDayIntervals: null, observationEndAt: new Date().toISOString(), provenanceHash: null };
    }
}
