import type { Socket } from 'socket.io';

const sessions = new Map<string, Set<Socket>>();
const key = (orgId: string, userId: string) => JSON.stringify([orgId, userId]);

export function trackUserSocket(socket: Socket, orgId: string, userId: string): void {
  const id = key(orgId, userId), sockets = sessions.get(id) ?? new Set<Socket>();
  sockets.add(socket); sessions.set(id, sockets);
  socket.once('disconnect', () => { sockets.delete(socket); if (!sockets.size) sessions.delete(id); });
}

/** Immediate revocation for user mutations handled in this server process. */
export function revokeUserSockets(orgId: string, userId: string): void {
  const id = key(orgId, userId), sockets = sessions.get(id);
  sessions.delete(id);
  for (const socket of sockets ?? []) socket.disconnect(true);
}
