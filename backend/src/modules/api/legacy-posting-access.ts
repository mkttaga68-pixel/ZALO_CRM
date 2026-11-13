import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { postingAccounts } from './manual-posting/access.js';

/** A BOT customer ID/phone is not a CRM contact ID. Match UID within its nick only. */
export async function legacyChaoHangVisibility(app: FastifyInstance, request: FastifyRequest): Promise<Prisma.Sql> {
  const user = request.user;
  const accountIds = (await postingAccounts(user)).map(a => a.id);
  if (!accountIds.length) return Prisma.sql`FALSE`;
  const scope = await app.scope.resolve('contact', user.id, user.orgId);
  const visibleUids: Record<string, Record<string, boolean>> = Object.create(null);
  const allowedContacts = new Map<string, boolean>();
  let cursor: string | undefined;
  for (;;) {
    const friends = await prisma.friend.findMany({ where: {
      orgId: user.orgId, zaloAccountId: { in: accountIds },
      contact: { is: { AND: [{ orgId: user.orgId }, (scope ?? {}) as Prisma.ContactWhereInput] } },
    }, select: { id: true, zaloAccountId: true, zaloUidInNick: true, contactId: true },
    orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    for (const friend of friends) {
      let allowed = allowedContacts.get(friend.contactId);
      if (allowed === undefined) {
        allowed = await app.policy.check('contact.view', { req: request, userId: user.id, orgId: user.orgId, resourceId: friend.contactId });
        allowedContacts.set(friend.contactId, allowed);
      }
      if (allowed && friend.zaloUidInNick) {
        visibleUids[friend.zaloAccountId] ??= Object.create(null);
        visibleUids[friend.zaloAccountId]![friend.zaloUidInNick] = true;
      }
    }
    if (friends.length < 500) break;
    cursor = friends[friends.length - 1]!.id;
  }
  // One JSON parameter avoids the parameter ceiling; keyed membership avoids
  // rescanning the entire friend list for every historical recipient.
  // Hide mixed/unmapped jobs, rather than leak recipients or misreport their totals.
  return Prisma.sql`j.org_id=${user.orgId} AND j.zalo_account_id IN (${Prisma.join(accountIds)})
    AND NOT EXISTS (SELECT 1 FROM chaohang_results r WHERE r.job_id=j.id AND
      (r.uid_used IS NULL OR NOT COALESCE(jsonb_exists(
        ${JSON.stringify(visibleUids)}::jsonb -> j.zalo_account_id, r.uid_used),false)))`;
}
