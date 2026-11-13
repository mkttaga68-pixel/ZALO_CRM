import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { canSeeConversationContent, type PrivacyContext } from '../privacy/redact.js';

/** Same-tenant account chat permission AND privacy AND conversation/contact policy. */
export async function canForwardConversation(app: FastifyInstance, request: FastifyRequest,
  conv: { id: string; orgId: string; zaloAccountId: string; contactId: string | null }, privacy: PrivacyContext) {
  const user = request.user;
  if (conv.orgId !== user.orgId) return false;
  const account = await prisma.zaloAccount.findFirst({
    where: { id: conv.zaloAccountId, orgId: user.orgId, archivedAt: null },
    select: { privacyMode: true, ownerUserId: true },
  });
  if (!account || !canSeeConversationContent({ zaloAccount: account }, privacy)) return false;
  if (!['owner','admin'].includes(user.role) && account.ownerUserId !== user.id) {
    const grant = await prisma.zaloAccountAccess.findFirst({ where: {
      userId: user.id, zaloAccountId: conv.zaloAccountId, permission: { in: ['chat','admin'] },
    }, select: { id: true } });
    if (!grant) return false;
  }
  if (!await app.policy.check('conversation.view', { req: request, userId: user.id, orgId: user.orgId, resourceId: conv.id })) return false;
  if (conv.contactId) {
    const scope = await app.scope.resolve('contact', user.id, user.orgId);
    const contact = await prisma.contact.findFirst({ where: { AND: [
      { id: conv.contactId, orgId: user.orgId }, (scope ?? {}) as Prisma.ContactWhereInput,
    ] }, select: { id: true } });
    if (!contact || !await app.policy.check('contact.view', { req: request, userId: user.id, orgId: user.orgId, resourceId: conv.contactId })) return false;
  }
  return true;
}
