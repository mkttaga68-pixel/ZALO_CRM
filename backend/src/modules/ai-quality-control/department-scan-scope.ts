import type { Conversation } from './contracts.js';

export function scopedDepartmentConversation(c: Conversation, departmentId: string, members: Set<string>, lookbackHours: number): Conversation | null {
  const since = Date.now() - lookbackHours * 3600000;
  const messages = c.messages.filter(m => Date.parse(m.occurredAt) >= since && m.timestampStatus === 'VERIFIED' &&
    (m.role === 'CUSTOMER' || m.role === 'HUMAN' && m.attribution === 'VERIFIED' && !!m.actorId && members.has(m.actorId))).slice(-50);
  if (!messages.some(m => m.role === 'HUMAN' && m.actorId && members.has(m.actorId))) return null;
  return { ...c, departmentIds: [departmentId], messages: messages.slice(-50), coverage: 'UNKNOWN', assignedActorId: null, assignmentStatus: 'UNKNOWN' };
}
