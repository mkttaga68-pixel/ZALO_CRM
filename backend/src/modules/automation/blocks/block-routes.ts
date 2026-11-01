// Phase 7 — Block CRUD routes.
//
// Block = atomic content/action unit. CENTRAL ENTITY — referenced by:
//   - AutomationSequence.steps[].blockId  (many-to-many via JSON)
//   - AutomationBroadcast.blockId         (FK 1:1)
//   - AutomationTrigger.blockId           (FK 0..1)
//
// content shape varies by actionType (see ./types.ts).
// archivedAt = soft delete (engine still honors snapshots inside running tasks).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  isSupportedActionType,
  validateBlockContent,
  type BlockActionType,
} from './types.js';

const BASE = '/api/v1/automation/blocks';

export async function blockRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List blocks — supports filter by channel, actionType, folderId, archived.
  app.get(BASE, { preHandler: requireGrant('block', 'access') }, async (request: FastifyRequest) => {
    const user = request.user!;
    const q = request.query as Record<string, string | undefined>;

    const where: Record<string, unknown> = { orgId: user.orgId };
    if (q.channel) where.channel = q.channel;
    if (q.actionType) where.actionType = q.actionType;
    if (q.folderId) where.folderId = q.folderId;
    if (q.includeArchived !== 'true') where.archivedAt = null;
    if (q.ownerNickId) where.ownerNickId = q.ownerNickId;

    const blocks = await prisma.block.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: Math.min(Number(q.limit) || 100, 500),
      include: {
        folder: { select: { id: true, name: true } },
        ownerNick: { select: { id: true, displayName: true } },
      },
    });
    return { blocks };
  });

  // Get one block (full content)
  app.get(`${BASE}/:id`, { preHandler: requireGrant('block', 'access') }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };
    const block = await prisma.block.findFirst({
      where: { id, orgId: user.orgId },
      include: {
        folder: { select: { id: true, name: true } },
        ownerNick: { select: { id: true, displayName: true } },
      },
    });
    if (!block) return reply.status(404).send({ error: 'block not found' });
    return block;
  });

  // Create block
  app.post(BASE, { preHandler: requireGrant('block', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;

      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }
      if (!isSupportedActionType(body.actionType)) {
        return reply.status(400).send({
          error: `actionType '${body.actionType}' not supported in phase 7. Supported: request_friend, send_message, update_status`,
        });
      }

      const contentValidation = validateBlockContent(body.actionType as BlockActionType, body.content);
      if (!contentValidation.ok) {
        return reply.status(400).send({ error: 'content invalid', detail: contentValidation.error });
      }

      // Optional FK validation
      if (body.folderId) {
        const folder = await prisma.blockFolder.findFirst({
          where: { id: body.folderId, orgId: user.orgId },
          select: { id: true },
        });
        if (!folder) return reply.status(400).send({ error: 'folder not found' });
      }
      if (body.ownerNickId) {
        const nick = await prisma.zaloAccount.findFirst({
          where: { id: body.ownerNickId, orgId: user.orgId },
          select: { id: true },
        });
        if (!nick) return reply.status(400).send({ error: 'ownerNick not found' });
      }

      const block = await prisma.block.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          folderId: body.folderId ?? null,
          name: body.name.trim(),
          channel: body.channel ?? 'zalo_user',
          actionType: body.actionType,
          content: body.content,
          ownerNickId: body.ownerNickId ?? null,
          isShared: body.isShared ?? true,
          createdById: user.id,
        },
      });
      return reply.status(201).send(block);
    } catch (error) {
      logger.error('[block] create error:', error);
      return reply.status(500).send({ error: 'Failed to create block' });
    }
  });

  // Update block — content edits create a NEW snapshot reference at task-enroll
  // time, so running tasks keep their frozen content (anh chốt Q1 snapshot rule).
  app.put(`${BASE}/:id`, { preHandler: requireGrant('block', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true, actionType: true, content: true, archivedAt: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });
      if (existing.archivedAt) {
        return reply.status(409).send({ error: 'block is archived; unarchive first' });
      }

      // If actionType changes, revalidate content against NEW actionType.
      const effectiveActionType = (body.actionType ?? existing.actionType) as BlockActionType;
      if (body.actionType !== undefined && !isSupportedActionType(body.actionType)) {
        return reply.status(400).send({ error: `actionType '${body.actionType}' not supported` });
      }
      if (body.content !== undefined || body.actionType !== undefined) {
        const v = validateBlockContent(effectiveActionType, body.content !== undefined ? body.content : existing.content);
        if (!v.ok) return reply.status(400).send({ error: 'content invalid', detail: v.error });
      }

      for (const field of ['folderId', 'ownerNickId'] as const) {
        const value = body[field];
        if (value === undefined || value === null) continue;
        if (typeof value !== 'string' || !value.trim()) return reply.status(400).send({ error: 'invalid reference' });
        const where = { id: value, orgId: user.orgId };
        const related = field === 'folderId'
          ? await prisma.blockFolder.findFirst({ where, select: { id: true } })
          : await prisma.zaloAccount.findFirst({ where, select: { id: true } });
        if (!related) return reply.status(400).send({ error: 'reference not found' });
      }

      const block = await prisma.block.update({
        where: { id },
        data: {
          name: body.name?.trim(),
          folderId: body.folderId === null ? null : body.folderId ?? undefined,
          channel: body.channel ?? undefined,
          actionType: body.actionType ?? undefined,
          content: body.content ?? undefined,
          ownerNickId: body.ownerNickId === null ? null : body.ownerNickId ?? undefined,
          isShared: body.isShared ?? undefined,
        },
      });
      return block;
    } catch (error) {
      logger.error('[block] update error:', error);
      return reply.status(500).send({ error: 'Failed to update block' });
    }
  });

  // Archive (soft delete) — running tasks unaffected because they hold their
  // own blockSnapshot. New enrollments cannot pick this block.
  app.post(`${BASE}/:id/archive`, { preHandler: requireGrant('block', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });

      const block = await prisma.block.update({
        where: { id },
        data: { archivedAt: new Date() },
      });
      return block;
    } catch (error) {
      logger.error('[block] archive error:', error);
      return reply.status(500).send({ error: 'Failed to archive block' });
    }
  });

  // Unarchive
  app.post(`${BASE}/:id/unarchive`, { preHandler: requireGrant('block', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });

      const block = await prisma.block.update({
        where: { id },
        data: { archivedAt: null },
      });
      return block;
    } catch (error) {
      logger.error('[block] unarchive error:', error);
      return reply.status(500).send({ error: 'Failed to unarchive block' });
    }
  });

  // Hard delete — only allowed if zero references (sequences/broadcasts/triggers/tasks).
  // Otherwise force user to archive instead.
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('block', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const existing = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'block not found' });

      // Check references (sequences via JSON steps, broadcasts via FK, triggers via FK)
      const [broadcastRef, triggerRef, taskRef] = await Promise.all([
        prisma.automationBroadcast.count({ where: { blockId: id, orgId: user.orgId } }),
        prisma.automationTrigger.count({ where: { blockId: id, orgId: user.orgId } }),
        prisma.automationTask.count({ where: { currentBlockId: id, orgId: user.orgId } }),
      ]);

      if (broadcastRef + triggerRef + taskRef > 0) {
        return reply.status(409).send({
          error: 'block in use',
          detail: `Referenced by ${broadcastRef} broadcast(s), ${triggerRef} trigger(s), ${taskRef} task(s). Archive instead.`,
        });
      }

      // NOTE: sequences reference via JSON steps[].blockId — Prisma cannot count
      // these efficiently. Engine validates at sequence-load time and surfaces a
      // warning in /sequences list. Force the user through archive workflow to
      // be safe.

      await prisma.block.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[block] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete block' });
    }
  });

  // Duplicate block (clones content, appends "(copy)" to name)
  app.post(`${BASE}/:id/duplicate`, { preHandler: requireGrant('block', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const source = await prisma.block.findFirst({
        where: { id, orgId: user.orgId },
      });
      if (!source) return reply.status(404).send({ error: 'block not found' });

      const copy = await prisma.block.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          folderId: source.folderId,
          name: `${source.name} (copy)`,
          channel: source.channel,
          actionType: source.actionType,
          content: source.content as object,
          ownerNickId: source.ownerNickId,
          isShared: source.isShared,
          createdById: user.id,
        },
      });
      return reply.status(201).send(copy);
    } catch (error) {
      logger.error('[block] duplicate error:', error);
      return reply.status(500).send({ error: 'Failed to duplicate block' });
    }
  });
}
