import {QcError,type Actor,type Conversation} from './contracts.js';
import {sourceFingerprint} from './manual-real-consent.js';
export interface ContinuousAuthority {jobId:string;messageId:string;departmentId:string;recipientUserIds:string[];actorId:string;orgId:string;sourceHash:string;validate:()=>Promise<void>}
const permits=new WeakMap<object,ContinuousAuthority>();
/** Server-side capability only. Never accepted from an HTTP body or serialized. */
export function issueContinuousAuthority(actor:Actor,conversation:Conversation,input:Omit<ContinuousAuthority,'actorId'|'orgId'|'sourceHash'>):object {
  const permit=Object.freeze({});permits.set(permit,{...input,actorId:actor.id,orgId:actor.orgId,sourceHash:sourceFingerprint(conversation)});return permit;
}
export async function consumeContinuousAuthority(permit:object,actor:Actor,conversation:Conversation):Promise<ContinuousAuthority>{
  const authority=permits.get(permit);permits.delete(permit);
  if(!authority||authority.actorId!==actor.id||authority.orgId!==actor.orgId||authority.sourceHash!==sourceFingerprint(conversation))throw new QcError('CONTINUOUS_AUTHORITY_INVALID',403);
  await authority.validate();return authority;
}
