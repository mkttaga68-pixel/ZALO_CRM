import { prisma } from '../../shared/database/prisma-client.js';

export class SessionRejected extends Error {
  constructor() { super('Unauthorized'); }
}

/** Revalidate persisted account state, not just the signed JWT snapshot.
 * A role/tenant change invalidates old claims and requires a new login. */
export async function assertActiveSession(claims: { id?: string; orgId?: string; role?: string }): Promise<void> {
  if (!claims?.id || !claims.orgId || !claims.role) throw new SessionRejected();
  const current = await prisma.user.findUnique({
    where: { id: claims.id }, select: { id: true, orgId: true, role: true, isActive: true },
  });
  if (!current || current.isActive !== true || current.orgId !== claims.orgId || current.role !== claims.role) {
    throw new SessionRejected();
  }
}
