// Phase 7 — BlockFolder CRUD routes.
//
// Folders organize Blocks (pattern smax.ai: KB BÁM ĐUỔI, PHÚ, THÀNH, NGỌC...).
// `ownerNickId` optional binding to a ZaloAccount — when set, engine prefers
// dispatch via that nick for blocks under this folder.
// `ownerUserId` optional binding to a sale User — folder cá nhân.
// Nested via `parentId` (1-level deep recommended; UI may flatten beyond 2).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../shared/database/prisma-client.js';
import { authMiddleware } from '../../auth/auth-middleware.js';
import { requireGrant } from '../../rbac/rbac-middleware.js';
import { logger } from '../../../shared/utils/logger.js';

const BASE = '/api/v1/automation/block-folders';

export async function blockFolderRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);

  // List folders (flat, client builds tree from parentId)
  app.get(BASE, { preHandler: requireGrant('block', 'access') }, async (request: FastifyRequest) => {
    const user = request.user!;
    const folders = await prisma.blockFolder.findMany({
      where: { orgId: user.orgId },
      orderBy: [{ ownerUserId: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { blocks: { where: { archivedAt: null } } } },
      },
    });
    return { folders };
  });

  // Create folder
  app.post(BASE, { preHandler: requireGrant('block', 'create') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const body = request.body as Record<string, any>;
      if (!body.name || typeof body.name !== 'string') {
        return reply.status(400).send({ error: 'name is required' });
      }

      // Validate parent exists in same org if provided
      if (body.parentId) {
        const parent = await prisma.blockFolder.findFirst({
          where: { id: body.parentId, orgId: user.orgId },
          select: { id: true },
        });
        if (!parent) return reply.status(400).send({ error: 'parent folder not found' });
      }

      const folder = await prisma.blockFolder.create({
        data: {
          id: randomUUID(),
          orgId: user.orgId,
          name: body.name.trim(),
          parentId: body.parentId ?? null,
          ownerNickId: body.ownerNickId ?? null,
          ownerUserId: body.ownerUserId ?? null,
          createdById: user.id,
        },
      });
      return reply.status(201).send(folder);
    } catch (error) {
      logger.error('[block-folder] create error:', error);
      return reply.status(500).send({ error: 'Failed to create folder' });
    }
  });

  // Update folder (rename / re-parent / change owner binding)
  app.put(`${BASE}/:id`, { preHandler: requireGrant('block', 'edit') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, any>;

      const existing = await prisma.blockFolder.findFirst({
        where: { id, orgId: user.orgId },
        select: { id: true },
      });
      if (!existing) return reply.status(404).send({ error: 'folder not found' });

      // Prevent setting parentId to self or descendant (simple guard: not self;
      // deeper cycle check would need recursive traversal — skip for now).
      if (body.parentId === id) {
        return reply.status(400).send({ error: 'folder cannot be its own parent' });
      }

      const folder = await prisma.blockFolder.update({
        where: { id },
        data: {
          name: body.name?.trim(),
          parentId: body.parentId === null ? null : body.parentId ?? undefined,
          ownerNickId: body.ownerNickId === null ? null : body.ownerNickId ?? undefined,
          ownerUserId: body.ownerUserId === null ? null : body.ownerUserId ?? undefined,
        },
      });
      return folder;
    } catch (error) {
      logger.error('[block-folder] update error:', error);
      return reply.status(500).send({ error: 'Failed to update folder' });
    }
  });

  // Delete folder — only if empty (no blocks, no children).
  // Admin override via ?force=true cascades blocks to parentId.
  app.delete(`${BASE}/:id`, { preHandler: requireGrant('block', 'delete') }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };
      const { force } = request.query as { force?: string };

      const existing = await prisma.blockFolder.findFirst({
        where: { id, orgId: user.orgId },
        include: {
          _count: { select: { blocks: true, children: true } },
        },
      });
      if (!existing) return reply.status(404).send({ error: 'folder not found' });

      if (existing._count.blocks > 0 || existing._count.children > 0) {
        if (force !== 'true') {
          return reply.status(409).send({
            error: 'folder not empty',
            detail: `${existing._count.blocks} block(s) + ${existing._count.children} child folder(s). Use ?force=true to cascade-detach.`,
          });
        }
        // Force: detach blocks and child folders (set their parent/folder to null)
        await prisma.$transaction([
          prisma.block.updateMany({ where: { folderId: id }, data: { folderId: null } }),
          prisma.blockFolder.updateMany({ where: { parentId: id }, data: { parentId: null } }),
        ]);
      }

      await prisma.blockFolder.delete({ where: { id } });
      return { success: true };
    } catch (error) {
      logger.error('[block-folder] delete error:', error);
      return reply.status(500).send({ error: 'Failed to delete folder' });
    }
  });
}
