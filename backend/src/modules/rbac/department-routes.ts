/**
 * department-routes.ts — RBAC Phase Phân Quyền 2026-05-21
 *
 * REST endpoints cho Department tree management.
 * Auth: tất cả routes require JWT + (sẽ thêm rbac middleware 'department.*' ở D8).
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../auth/auth-middleware.js';
import {
  getOrgDepartmentTree,
  createDepartment,
  updateDepartment,
  archiveDepartment,
  assignUserToDepartment,
  removeUserFromDepartment,
  getUsersUnderDepartment,
} from './department-service.js';
import { userHasGrant } from './permission-group-service.js';
import type { Resource, Action } from './permission-types.js';
import { assertManageUser, withPermissionAuthority } from './permission-authority.js';

/**
 * TEMP RBAC guard cho D5-6 (proper middleware ship ở D8).
 * Codex review P1 finding: mọi authenticated user có thể CRUD dept/group.
 * Tạm dùng userHasGrant + legacy role='owner' fallback.
 */
function requireGrant(resource: Resource, action: Action) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const allowed = await userHasGrant(user.userId ?? user.id, resource, action);
    if (!allowed) return reply.status(403).send({ error: `Forbidden: ${resource}.${action}` });
  };
}

export async function registerDepartmentRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/departments — full tree
  app.get('/api/v1/departments', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const tree = await getOrgDepartmentTree(user.orgId);
    return reply.send({ tree });
  });

  // POST /api/v1/departments — tạo dept mới
  app.post('/api/v1/departments', { preHandler: [authMiddleware, requireGrant('department', 'create')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const body = (request.body ?? {}) as {
      name?: string;
      parentId?: string | null;
      displayOrder?: number;
    };
    try {
      const dept = await createDepartment({
        orgId: user.orgId,
        name: body.name ?? '',
        parentId: body.parentId ?? null,
        displayOrder: body.displayOrder,
      });
      return reply.send({ ok: true, department: dept });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // PATCH /api/v1/departments/:id — rename, move parent, reorder
  app.patch('/api/v1/departments/:id', { preHandler: [authMiddleware, requireGrant('department', 'edit')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      name?: string;
      parentId?: string | null;
      displayOrder?: number;
    };
    try {
      const dept = await updateDepartment({
        orgId: user.orgId,
        id,
        name: body.name,
        parentId: body.parentId,
        displayOrder: body.displayOrder,
      });
      return reply.send({ ok: true, department: dept });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // DELETE /api/v1/departments/:id — archive (soft delete)
  app.delete('/api/v1/departments/:id', { preHandler: [authMiddleware, requireGrant('department', 'delete')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    try {
      await archiveDepartment(user.orgId, id);
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(400).send({ error: e.message });
    }
  });

  // POST /api/v1/departments/:id/members — add/move user vào dept với role
  app.post('/api/v1/departments/:id/members', { preHandler: [authMiddleware, requireGrant('user', 'edit')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as {
      userId?: string;
      deptRole?: 'leader' | 'deputy' | 'member';
    };
    if (!body.userId) return reply.status(400).send({ error: 'userId required' });
    const deptRole = body.deptRole ?? 'member';
    try {
      await withPermissionAuthority(user.id,user.orgId,'user','edit',async(tx,authority)=>{
        assertManageUser(authority,body.userId!);
        await assignUserToDepartment({
        orgId: user.orgId,
        departmentId: id,
        userId: body.userId!,
        deptRole,
        },tx);
      });
      return reply.send({ ok: true });
    } catch (e: any) {
      // Catch unique constraint violation (1 leader/dept hoặc 1 deputy/dept đã có)
      if (e.code === 'P2002') {
        const which = deptRole === 'leader' ? 'trưởng phòng' : deptRole === 'deputy' ? 'phó phòng' : 'thành viên';
        return reply.status(409).send({ error: `Phòng ban đã có ${which} — đổi role hoặc remove người cũ trước` });
      }
      return reply.status(e.statusCode ?? 400).send({ error: e.message });
    }
  });

  // DELETE /api/v1/departments/:id/members/:userId — remove user khỏi dept
  app.delete('/api/v1/departments/:id/members/:userId', { preHandler: [authMiddleware, requireGrant('user', 'edit')] }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    // FIX codex review #6: validate user thuộc đúng dept :id trước khi remove
    const { id: deptId, userId } = request.params as { id: string; userId: string };
    try {
      await withPermissionAuthority(user.id,user.orgId,'user','edit',async(tx,authority)=>{
        assertManageUser(authority,userId);
        await removeUserFromDepartment(user.orgId,userId,deptId,tx);
      });
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.status(e.statusCode ?? 400).send({ error: e.message });
    }
  });

  // GET /api/v1/departments/:id/members-tree — list users trong dept + sub-depts
  // Endpoint này dùng cho leader xem danh sách "ai dưới quyền tôi"
  app.get('/api/v1/departments/:id/members-tree', { preHandler: authMiddleware }, async (request, reply) => {
    const user = (request as any).user;
    if (!user) return reply.status(401).send({ error: 'unauthorized' });
    const { id } = request.params as { id: string };
    const userIds = await getUsersUnderDepartment(user.orgId, id);
    return reply.send({ userIds });
  });
}
