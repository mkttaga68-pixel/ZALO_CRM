import {demand,QcError,type Actor,type WorkspaceRepository} from '../contracts.js';
import {audit,digest} from '../knowledge.js';
import {redactPII} from '../analysis.js';
import type {MonitoringRepository,MonitoringState} from './contracts.js';

export const MONITORING_LIMITS={jobs:5000,warnings:10000,bytes:32*1024*1024} as const;

/** Rows eligible under the tenant's APPROVED workspace retention policy. Never eligible:
 * PENDING/PROCESSING/RETRY jobs, OPEN warnings, undelivered or unacknowledged notifications. */
export function monitoringPurgeCandidates(state:MonitoringState,retentionDays:number,now:number){
 const cutoff=now-retentionDays*86400000;
 const warnings=state.warnings.filter(w=>w.status!=='OPEN'&&w.updatedAt<=cutoff&&state.deliveries.filter(d=>d.warningId===w.id).every(d=>d.delivered));
 const warningIds=new Set(warnings.map(w=>w.id));
 const jobs=state.jobs.filter(j=>(j.state==='DONE'||j.state==='DEAD')&&j.updatedAt<=cutoff);
 const deliveries=state.deliveries.filter(d=>warningIds.has(d.warningId)||(d.delivered&&d.createdAt<=cutoff&&!state.warnings.some(w=>w.id===d.warningId&&w.status==='OPEN')));
 return {cutoff,jobs,warnings,deliveries};
}

/** Explicit operator purge for monitoring rows. Audit-first: one MONITORING_RETENTION_PURGE audit (ids,
 * tombstone digest, redacted reason) is committed to the workspace BEFORE rows are deleted, so a deletion is
 * never silent. Deletion is by exact id and idempotent; a crash between the two steps is repaired by re-running.
 * Idempotency horizon: a purged job key may be re-enqueued if the same synthetic event is replayed after purge. */
export async function purgeMonitoring(store:MonitoringRepository,workspace:WorkspaceRepository,actor:Actor,reason:unknown,now=Date.now()){
 demand(actor,'delete');demand(actor,'view_all');
 if(typeof reason!=='string'||!reason.trim()||reason.length>1000)throw new QcError('PURGE_REASON_REQUIRED');
 const settings=(await workspace.read(actor.orgId)).settings;
 if(!settings.retentionDays||!settings.retentionApprovedBy)throw new QcError('APPROVED_RETENTION_POLICY_REQUIRED',403);
 const c=monitoringPurgeCandidates(await store.read(actor.orgId),settings.retentionDays,now);
 if(!c.jobs.length&&!c.warnings.length&&!c.deliveries.length)return {jobs:0,warnings:0,deliveries:0,tombstoneHash:null};
 const ids={jobs:c.jobs.map(j=>j.id).sort(),warnings:c.warnings.map(w=>w.id).sort(),deliveries:c.deliveries.map(d=>d.id).sort()};
 const tombstoneHash=digest(JSON.stringify([ids,c.warnings.map(w=>[w.id,w.evidenceHash,w.version,w.reviews.length]).sort()]));
 await workspace.mutate(actor.orgId,s=>audit(s,actor,'MONITORING_RETENTION_PURGE','monitoring-retention',{jobs:ids.jobs.length,warnings:ids.warnings.length,deliveries:ids.deliveries.length,warningIds:ids.warnings,cutoff:new Date(c.cutoff).toISOString(),retentionDays:settings.retentionDays,tombstoneHash,reason:redactPII(reason)}));
 const sets={jobs:new Set(ids.jobs),warnings:new Set(ids.warnings),deliveries:new Set(ids.deliveries)};
 return store.mutate(actor.orgId,s=>{
  // Re-check eligibility inside the store lock: a row that became active since the audit is kept.
  const fresh=monitoringPurgeCandidates(s,settings.retentionDays!,now),ok={jobs:new Set(fresh.jobs.map(j=>j.id)),warnings:new Set(fresh.warnings.map(w=>w.id)),deliveries:new Set(fresh.deliveries.map(d=>d.id))};
  const before={jobs:s.jobs.length,warnings:s.warnings.length,deliveries:s.deliveries.length};
  s.jobs=s.jobs.filter(j=>!(sets.jobs.has(j.id)&&ok.jobs.has(j.id)));
  s.warnings=s.warnings.filter(w=>!(sets.warnings.has(w.id)&&ok.warnings.has(w.id)));
  s.deliveries=s.deliveries.filter(d=>!(sets.deliveries.has(d.id)&&ok.deliveries.has(d.id)));
  return {jobs:before.jobs-s.jobs.length,warnings:before.warnings-s.warnings.length,deliveries:before.deliveries-s.deliveries.length,tombstoneHash};
 });
}
