/**
 * chao-hang-routes.ts — API đọc (JWT) phục vụ tab "Chào hàng" trên CRM.
 * Read-only: liệt kê job + tỷ lệ gửi, và chi tiết từng khách. KHÔNG bao giờ trả
 * internal_key ra ngoài (chỉ select cột an toàn).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import { requireGrant } from '../rbac/rbac-middleware.js';
import { logger } from '../../shared/utils/logger.js';

// Các cột job an toàn để serve (LOẠI internalKey/botBaseUrl).
const JOB_SELECT = {
  id: true,
  botJobId: true,
  poCode: true,
  zaloAccountId: true,
  status: true,
  totalCount: true,
  sentCount: true,
  failedCount: true,
  skippedCount: true,
  error: true,
  finishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function chaoHangRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authMiddleware);
  app.addHook('preHandler', requireGrant('posting', 'access'));

  // GET /api/v1/chao-hang/jobs?status&page&limit
  app.get('/api/v1/chao-hang/jobs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const q = request.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(q.page || '1') || 1);
      const limit = Math.min(100, Math.max(1, parseInt(q.limit || '30') || 30));

      const where: any = { orgId: user.orgId };
      if (q.status && ['running', 'done', 'failed'].includes(q.status)) where.status = q.status;

      const [jobs, total] = await Promise.all([
        prisma.chaoHangJob.findMany({
          where,
          select: JOB_SELECT,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.chaoHangJob.count({ where }),
      ]);

      return { jobs, total, page, limit };
    } catch (err) {
      logger.error('[chao-hang] list jobs error:', err);
      return reply.status(500).send({ error: 'Failed to fetch chao-hang jobs' });
    }
  });

  // GET /api/v1/chao-hang/jobs/:id — chi tiết job + kết quả từng khách
  app.get('/api/v1/chao-hang/jobs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { id } = request.params as { id: string };

      const job = await prisma.chaoHangJob.findFirst({
        where: { id, orgId: user.orgId },
        select: JOB_SELECT,
      });
      if (!job) return reply.status(404).send({ error: 'Job not found' });

      const results = await prisma.chaoHangResult.findMany({
        where: { jobId: id },
        select: {
          id: true, customerId: true, name: true, phone: true, tier: true,
          uidUsed: true, status: true, error: true, imagesCount: true,
          sentAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return { job, results };
    } catch (err) {
      logger.error('[chao-hang] get job error:', err);
      return reply.status(500).send({ error: 'Failed to fetch chao-hang job' });
    }
  });
}
