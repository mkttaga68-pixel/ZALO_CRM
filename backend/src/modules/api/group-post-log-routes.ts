/**
 * group-post-log-routes.ts — Nhật ký đăng bài vào nhóm Zalo (bot bắn qua public API).
 * JWT auth, scoped theo org. Phục vụ tab "Nhật ký đăng bài" trên CRM để soi lỗi.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';
import { postingAccounts } from './manual-posting/access.js';

export async function groupPostLogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireGrant('posting', 'access'));

  // GET /api/v1/group-post-logs?accountId&status&page&limit
  app.get('/api/v1/group-post-logs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const q = request.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(q.page || '1') || 1);
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '30') || 30));

      const accounts = (await postingAccounts(user)).map(a => a.id);
      if (q.accountId && !accounts.includes(q.accountId)) return reply.status(404).send({ error: 'Không tìm thấy tài khoản trong phạm vi truy cập' });
      const where: any = { orgId: user.orgId, zaloAccountId: q.accountId ?? { in: accounts } };
      if (q.status && ['ok', 'partial', 'failed'].includes(q.status)) where.status = q.status;

      const [logs, total] = await Promise.all([
        prisma.groupPostLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.groupPostLog.count({ where }),
      ]);

      return { logs, total, page, limit };
    } catch (err) {
      logger.error('[group-post-log] list error:', err);
      return reply.status(500).send({ error: 'Failed to fetch logs' });
    }
  });
}
