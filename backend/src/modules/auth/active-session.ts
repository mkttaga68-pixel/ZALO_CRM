import { prisma } from '../../shared/database/prisma-client.js';
import { matchesCredentialVersion } from './credential-version.js';

export class SessionRejected extends Error {
  constructor() { super('Unauthorized'); }
}

/** Revalidate persisted account state, not just the signed JWT snapshot.
 * A role/tenant change invalidates old claims and requires a new login. */
type ActorClaims = { id?: string; orgId?: string; role?: string };
async function currentActor(claims: ActorClaims) {
  if (!claims?.id || !claims.orgId || !claims.role) throw new SessionRejected();
  const current = await prisma.user.findUnique({
    where: { id: claims.id }, select: { id: true, orgId: true, role: true, isActive: true, passwordHash: true },
  });
  if (!current || current.isActive !== true || current.orgId !== claims.orgId || current.role !== claims.role) {
    throw new SessionRejected();
  }
  return current;
}

/** Internal jobs revalidate actor/tenant/role without pretending to be a JWT. */
export async function assertActiveActor(claims: ActorClaims): Promise<void> {
  await currentActor(claims);
}

/** A password reset revokes old HTTP/socket tokens without a schema migration. */
export async function assertActiveSession(claims: ActorClaims & { credentialVersion?: string }): Promise<void> {
  const current = await currentActor(claims);
  if (!matchesCredentialVersion(claims.credentialVersion, current.id, current.passwordHash)) throw new SessionRejected();
}
