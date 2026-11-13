import { randomUUID, createHash } from 'node:crypto';
import { canonicalJson, QcError, type Actor, type Conversation, type ProviderInput } from './contracts.js';

export interface ManualSelection { messageLimit: number; redactions: string[] }
interface Ticket extends ManualSelection { actorId: string; orgId: string; conversationId: string; sourceHash: string; inputHash: string; authorityEpoch: number; observationEndAt: string; expires: number }
const previews = new Map<string, Ticket>();
const permits = new Map<string, { hash: string; expires: number; uses: number }>();
const connections = new Map<string, number>();
export const inputFingerprint = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
export const sourceFingerprint = (c: Conversation) => inputFingerprint({...c,observationEndAt:null});
const connectionId=(orgId:string,model:string,key:string)=>inputFingerprint([orgId,model,key]);
export function recordVerifiedManualConnection(orgId:string,model:string,key:string) {
    const id=connectionId(orgId,model,key);connections.set(id,Date.now()+86400000);setTimeout(()=>connections.delete(id),86400000).unref();
}
export function hasVerifiedManualConnection(orgId:string,model:string,key?:string) { return !!key && (connections.get(connectionId(orgId,model,key))??0)>Date.now(); }
export function manualSelection(value: Partial<ManualSelection> = {}): ManualSelection {
    const messageLimit = value.messageLimit ?? 20, redactions = value.redactions ?? [];
    if (![10,20,50].includes(messageLimit) || !Array.isArray(redactions) || redactions.length > 20 || redactions.some(s => typeof s !== 'string' || s.trim().length < 2 || s.length > 128)) throw new QcError('MANUAL_SELECTION_INVALID');
    return {messageLimit,redactions:[...new Set(redactions.map(s=>s.trim()))]};
}
export function extraRedact(text: string, terms: string[]) { for (const term of terms) text = text.split(term).join('[REDACTED]'); return text; }
export function issueManualPreview(actor: Actor, c: Conversation, selection: ManualSelection, input: ProviderInput, authorityEpoch: number) {
    if (previews.size >= 200) throw new QcError('MANUAL_PREVIEW_CAPACITY',429);
    const token = randomUUID(), expires = Date.now()+300000;
    previews.set(token,{...selection,actorId:actor.id,orgId:actor.orgId,conversationId:c.id,sourceHash:sourceFingerprint(c),inputHash:inputFingerprint(input),authorityEpoch,observationEndAt:c.observationEndAt,expires});
    setTimeout(()=>previews.delete(token),300000).unref();
    return {previewToken:token,expiresAt:new Date(expires).toISOString()};
}
export function consumeManualPreview(token: unknown, actor: Actor, c: Conversation): Ticket {
    const ticket = typeof token === 'string' ? previews.get(token) : undefined;
    if (!ticket || ticket.expires <= Date.now() || ticket.actorId !== actor.id || ticket.orgId !== actor.orgId || ticket.conversationId !== c.id) throw new QcError('MANUAL_PREVIEW_REQUIRED',409);
    previews.delete(token as string);
    if (ticket.sourceHash !== sourceFingerprint(c)) throw new QcError('MANUAL_PREVIEW_CHANGED',409);
    return ticket;
}
/** Opaque server-only permit. It is never returned to a browser or sent to OpenAI. */
export function issueManualEgressPermit(input: ProviderInput): string {
    if (permits.size >= 200 || input.conversation.source !== 'CRM') throw new QcError('MANUAL_EGRESS_DENIED',403);
    const token=randomUUID();permits.set(token,{hash:inputFingerprint(input),expires:Date.now()+60000,uses:0});
    setTimeout(()=>permits.delete(token),60000).unref();return token;
}
export function consumeManualEgressPermit(input: ProviderInput & {_manualPermit?:string}): ProviderInput {
    const { _manualPermit, ...clean } = input, permit=typeof _manualPermit==='string'?permits.get(_manualPermit):undefined;
    if (!permit || permit.expires<=Date.now() || permit.uses>=2 || permit.hash!==inputFingerprint(clean)) throw new QcError('MANUAL_EGRESS_DENIED',403);
    permit.uses++;return clean;
}
