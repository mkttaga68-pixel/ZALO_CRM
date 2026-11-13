import { Adapter, type BroadcastOptions } from 'socket.io-adapter';
import type { Socket } from 'socket.io';
import { userHasGrant } from '../modules/rbac/permission-group-service.js';
import { prisma } from './database/prisma-client.js';
import { getZaloScope } from '../modules/zalo/zalo-scope.js';
import type { Resource } from '../modules/rbac/permission-types.js';
import { assertActiveActor } from '../modules/auth/active-session.js';

/** Check every outgoing broadcast, including io.emit() and existing org rooms.
 * A room subscription alone never authorizes receipt of another module's data.
 */
export async function mayReceiveModuleEvent(socket: Socket, packet: any, options: BroadcastOptions): Promise<boolean> {
  const identity = socket.data.identity as {userId?:string;orgId?:string;role?:string}|undefined;
  if (!identity?.userId || !identity.orgId) return false;
  await assertActiveActor({id:identity.userId,orgId:identity.orgId,role:identity.role});
  const event = packet.data?.[0];
  const payload = packet.data?.[1];
  if (typeof event !== 'string' || !payload || typeof payload !== 'object') return false;
  const resource: Resource | undefined = event.startsWith('chat:') || event.startsWith('autoreply:') ||
    ['zalo:typing','zalo:seen','zalo:delivered','zalo:message-status'].includes(event) ? 'conversation' :
    event.startsWith('friend:') ? 'friend' : event.startsWith('group:') ? 'group' :
    event.startsWith('zalo:') ? 'zalo_account' : undefined;
  if (!resource || !await userHasGrant(identity.userId,resource,'access')) return false;
  const roomOrgs = [...options.rooms].filter(r=>r.startsWith('org:')).map(r=>r.slice(4));
  if (roomOrgs.length && !roomOrgs.includes(identity.orgId)) return false;
  let accountId = payload.accountId ?? payload.zaloAccountId ?? payload.message?.zaloAccountId;
  const conversationId = payload.conversationId ?? payload.conversation?.id;
  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({where:{id:conversationId,orgId:identity.orgId},select:{zaloAccountId:true}});
    if (!conversation) return false;
    if (accountId && accountId !== conversation.zaloAccountId) return false;
    accountId = conversation.zaloAccountId;
  }
  if (!accountId && payload.friendId) {
    const friend = await prisma.friend.findFirst({where:{id:payload.friendId,orgId:identity.orgId},select:{zaloAccountId:true}});
    accountId = friend?.zaloAccountId;
  }
  if (typeof accountId !== 'string') return false;
  const account = await prisma.zaloAccount.findFirst({where:{id:accountId,orgId:identity.orgId,archivedAt:null},select:{privacyMode:true}});
  // A socket does not carry the HTTP PIN context; private content must be fetched
  // through the existing PIN-aware API rather than broadcast without redaction.
  if (!account || account.privacyMode === 'main') return false;
  const scope = await getZaloScope(identity.userId,identity.orgId,identity.role ?? 'member');
  if (!scope.accessibleIds.includes(accountId)) return false;
  if (/qr/i.test(event) && !await userHasGrant(identity.userId,'zalo_account','edit')) return false;
  return true;
}

export class RbacSocketAdapter extends Adapter {
  private pending = 0;
  private delivery: Promise<void> = Promise.resolve();

  private enqueue(packet: any, opts: BroadcastOptions, send: (allowed: BroadcastOptions)=>void): void {
    if (this.pending >= 2_000) return; // Drop rather than bypass checks under load.
    this.pending++;
    const options = {...opts,rooms:new Set(opts.rooms),except:new Set(opts.except)};
    this.delivery = this.delivery.then(async()=>{
      const sockets = await this.fetchSockets(options) as Socket[];
      const allowedIds: string[] = [];
      for (const socket of sockets) {
        try { if (await mayReceiveModuleEvent(socket,packet,options)) allowedIds.push(socket.id); } catch { /* fail closed */ }
      }
      // Use individual socket rooms, preserving exclusions and preventing sockets
      // that joined the org after authorization from receiving the packet.
      if (allowedIds.length) send({...options,rooms:new Set(allowedIds)});
    }).catch(()=>{}).finally(()=>{this.pending--;});
  }

  override broadcast(packet: any, opts: BroadcastOptions): void {
    this.enqueue(packet,opts,allowed=>super.broadcast(packet,allowed));
  }

  override broadcastWithAck(packet: any, opts: BroadcastOptions, count: (n:number)=>void, ack: (...args:any[])=>void): void {
    // No application broadcast-with-ack callers currently exist. Keep the same
    // authorization boundary if one is introduced later.
    this.enqueue(packet,opts,allowed=>super.broadcastWithAck(packet,allowed,count,ack));
  }
}
