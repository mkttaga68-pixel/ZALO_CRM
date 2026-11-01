import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../shared/database/prisma-client.js';
import { assertActiveSession } from '../../auth/active-session.js';
import { userHasGrant } from '../../rbac/permission-group-service.js';
import { PostingError, type PostingKind, type PostingTarget, type PostingViewer } from './contracts.js';

export async function postingAccounts(viewer: PostingViewer) {
  await assertActiveSession(viewer);
  // Re-read grants for every account/recipient check, including background jobs.
  if (!await userHasGrant(viewer.id, 'posting', 'access')) {
    throw new PostingError(403, 'Bạn chưa được cấp quyền Đăng bài (Đăng nhóm / Chào hàng).');
  }
  const admin = ['owner', 'admin'].includes(viewer.role);
  const grants = admin ? [] : await prisma.zaloAccountAccess.findMany({
    where: { userId: viewer.id, permission: { in: ['chat', 'admin'] } }, select: { zaloAccountId: true },
  });
  return prisma.zaloAccount.findMany({
    where: {
      orgId: viewer.orgId, archivedAt: null, privacyMode: { not: 'main' },
      ...(admin ? {} : { OR: [{ ownerUserId: viewer.id }, { id: { in: grants.map(g => g.zaloAccountId) } }] }),
    },
    select: { id: true, displayName: true, status: true }, orderBy: { id: 'asc' }, take: 200,
  });
}

export async function requirePostingAccount(viewer: PostingViewer, id: string, connected = false) {
  const account = (await postingAccounts(viewer)).find(a => a.id === id);
  if (!account) throw new PostingError(404, 'Không có quyền gửi bằng nick này. Chỉ dùng nick công việc có quyền chat.');
  if (connected && account.status !== 'connected') throw new PostingError(409, 'Nick gửi chưa kết nối.');
  return account;
}

export async function postingTargets(app: FastifyInstance, viewer: PostingViewer, accountId: string, kind: PostingKind,
  options: { ids?: string[]; query?: string; offset?: number; req?: unknown } = {}): Promise<{ targets: PostingTarget[]; nextOffset: number | null }> {
  await requirePostingAccount(viewer, accountId);
  const skip = options.ids ? 0 : options.offset ?? 0;
  const query = options.query?.slice(0, 80).trim();
  let targets: PostingTarget[];
  if (kind === 'GROUP') {
    const rows = await prisma.conversation.findMany({
      where: { orgId: viewer.orgId, zaloAccountId: accountId, threadType: 'group', externalThreadId: { not: '' },
        ...(options.ids ? { id: { in: options.ids } } : {}), ...(query ? { groupName: { contains: query, mode: 'insensitive' } } : {}) },
      select: { id: true, externalThreadId: true, groupName: true }, orderBy: { id: 'asc' }, skip, take: 51,
    });
    targets = [];
    for (const row of rows.slice(0, 50)) if (row.externalThreadId && await app.policy.check('conversation.view', { req: options.req, userId: viewer.id, orgId: viewer.orgId, resourceId: row.id })) {
      targets.push({ id: row.id, threadId: row.externalThreadId, name: row.groupName || 'Nhóm chưa có tên' });
    }
    return { targets: targets.slice(0, 50), nextOffset: !options.ids && rows.length === 51 ? skip + 50 : null };
  }
  const contactScope = await app.scope.resolve('contact', viewer.id, viewer.orgId);
  const rows = await prisma.friend.findMany({
    where: { orgId: viewer.orgId, zaloAccountId: accountId, friendshipStatus: 'accepted', zaloUidInNick: { not: '' },
      ...(options.ids ? { id: { in: options.ids } } : {}),
      contact: { is: { AND: [{ orgId: viewer.orgId }, (contactScope ?? {}) as Prisma.ContactWhereInput] } },
      ...(query ? { OR: [{ aliasInNick: { contains: query, mode: 'insensitive' } }, { zaloDisplayName: { contains: query, mode: 'insensitive' } }, { contact: { fullName: { contains: query, mode: 'insensitive' } } }] } : {}) },
    select: { id: true, contactId: true, zaloUidInNick: true, aliasInNick: true, zaloDisplayName: true, contact: { select: { fullName: true } } },
    orderBy: { id: 'asc' }, skip, take: 51,
  });
  targets = [];
  for (const row of rows.slice(0, 50)) if (await app.policy.check('contact.view', { req: options.req, userId: viewer.id, orgId: viewer.orgId, resourceId: row.contactId })) {
    targets.push({ id: row.id, threadId: row.zaloUidInNick, contactId: row.contactId, name: row.aliasInNick || row.zaloDisplayName || row.contact.fullName || 'Khách hàng' });
  }
  return { targets: targets.slice(0, 50), nextOffset: !options.ids && rows.length === 51 ? skip + 50 : null };
}
