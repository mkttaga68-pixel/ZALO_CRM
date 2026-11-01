/**
 * Auth middleware — verifies JWT on protected routes.
 * JWT user shape is defined in shared/types/fastify-jwt-user.d.ts.
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { assertActiveSession, SessionRejected } from './active-session.js';

const validated = new WeakMap<FastifyRequest, string>();

async function checkCurrentAccount(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const identity = request.user;
  const key = JSON.stringify([identity?.id, identity?.orgId, identity?.role]);
  if (validated.get(request) === key) return;
  try {
    await assertActiveSession(identity);
    validated.set(request, key);
  } catch (error) {
    reply.status(error instanceof SessionRejected ? 401 : 503).send({ error: error instanceof SessionRejected ? 'Unauthorized' : 'Authentication unavailable' });
  }
}

/** Public routes remain anonymous when no valid JWT is present; a valid but
 * revoked/stale JWT is never accepted by plugin routes relying on req.user. */
export async function optionalAuthMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try { await request.jwtVerify(); } catch { return; }
  await checkCurrentAccount(request, reply);
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.status(401).send({ error: 'Unauthorized' });
    return;
  }
  await checkCurrentAccount(request, reply);
}
