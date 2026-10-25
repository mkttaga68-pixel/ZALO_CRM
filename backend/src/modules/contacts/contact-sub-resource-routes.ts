/**
 * contact-sub-resource-routes.ts — Sub-resource endpoints for contacts.
 * Provides appointments scoped to a specific contact.
 * All routes require JWT auth and are scoped to the user's org.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { logger } from '../../shared/utils/logger.js';

export async function contactSubResourceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // ── GET /api/v1/contacts/:id/appointments — appointments for contact ───────
  app.get('/api/v1/contacts/:id/appointments', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const appointments = await prisma.appointment.findMany({
        where: { contactId: id, orgId: user.orgId },
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          statusChangedBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { appointmentDate: 'desc' },
        take: 20,
      });

      return { appointments };
    } catch (err) {
      logger.error('[contacts] Appointments by contact error:', err);
      return reply.status(500).send({ error: 'Failed to fetch appointments' });
    }
  });

  // ── GET /api/v1/contacts/:id/crm-tag-events ──────────────────────────────
  // Vết đầy đủ "gắn tag CRM → Bot-Auto → gửi Zalo" của 1 KH (2026-10-25).
  //
  // Timeline KH đã có "ai gắn / lúc nào / có vào kịch bản không" qua ActivityLog.
  // Endpoint này trả thêm phần phải join mới có: nick nào được giao gửi, task ở
  // trạng thái gì, lỗi hoặc lý do bỏ qua ở cấp task. Dùng cho panel chi tiết +
  // bảng nghiệm thu.
  app.get('/api/v1/contacts/:id/crm-tag-events', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const limit = Math.min(Number((request.query as Record<string, string>)?.limit ?? 20) || 20, 100);

      // Org isolation: lọc theo orgId của người gọi, không tin tưởng :id.
      const events = await prisma.crmTagEvent.findMany({
        where: { contactId: id, orgId: user.orgId },
        orderBy: { occurredAt: 'desc' },
        take: limit,
        select: {
          id: true, tagName: true, crmTagId: true, occurredAt: true, source: true,
          state: true, attemptCount: true, dispatchedAt: true, result: true, lastError: true,
          actor: { select: { id: true, fullName: true, email: true } },
        },
      });
      if (events.length === 0) return { events: [] };

      // Task sinh ra từ các campaign của trigger crm_tag_added cho đúng KH này.
      // Không có FK event → task (materializer dùng chung cho mọi eventType), nên
      // ghép theo thời gian: task tạo SAU khi event xảy ra là task của event đó.
      const tasks = await prisma.automationTask.findMany({
        where: {
          orgId: user.orgId,
          contactId: id,
          campaign: { trigger: { eventType: 'crm_tag_added' } },
          createdAt: { gte: events[events.length - 1].occurredAt },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, state: true, skipReason: true, errorMessage: true, attemptCount: true,
          scheduledAt: true, executedAt: true, createdAt: true, currentStepIdx: true,
          assignedNick: { select: { id: true, displayName: true, status: true } },
          campaign: {
            select: {
              id: true,
              sequence: { select: { id: true, name: true } },
              trigger: { select: { id: true, name: true, eventFilter: true } },
            },
          },
        },
      });

      return {
        events: events.map((e) => ({
          ...e,
          // Task của event này = task thuộc trigger có eventFilter.crmTagId khớp
          // và được tạo sau thời điểm gắn tag.
          tasks: tasks.filter((t) => {
            const f = t.campaign?.trigger?.eventFilter as Record<string, unknown> | null;
            return f?.crmTagId === e.crmTagId && t.createdAt >= e.occurredAt;
          }),
        })),
      };
    } catch (err) {
      logger.error('[contacts] CRM tag events error:', err);
      return reply.status(500).send({ error: 'Failed to fetch CRM tag events' });
    }
  });

  // ── GET /api/v1/contacts/by-zalo-uid/:uid — lookup CRM contact by Zalo UID
  // Trả contact info + assigned user + count conversations để dùng cho user dialog
  app.get('/api/v1/contacts/by-zalo-uid/:uid', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { uid } = request.params as { uid: string };

      const contact = await prisma.contact.findFirst({
        where: { zaloUid: uid, orgId: user.orgId, mergedInto: null },
        include: {
          assignedUser: { select: { id: true, fullName: true, email: true } },
          _count: { select: { conversations: true, appointments: true } },
        },
      });

      if (!contact) return reply.send({ contact: null });

      // Last conversation for "Nhắn tin" deep-link
      const lastConv = await prisma.conversation.findFirst({
        where: { contactId: contact.id, orgId: user.orgId },
        orderBy: { lastMessageAt: 'desc' },
        select: { id: true, zaloAccountId: true },
      });

      return {
        contact: {
          id: contact.id,
          fullName: contact.fullName,
          crmName: contact.crmName,
          phone: contact.phone,
          email: contact.email,
          source: contact.source,
          status: contact.status,
          notes: contact.notes,
          tags: contact.tags,
          leadScore: contact.leadScore,
          firstContactDate: contact.firstContactDate,
          lastActivity: contact.lastActivity,
          assignedUser: contact.assignedUser,
          conversationsCount: contact._count.conversations,
          appointmentsCount: contact._count.appointments,
          lastConversationId: lastConv?.id ?? null,
        },
      };
    } catch (err) {
      logger.error('[contacts] By zalo uid error:', err);
      return reply.status(500).send({ error: 'Failed to fetch contact' });
    }
  });
}
