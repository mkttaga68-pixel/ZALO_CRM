import type {FastifyInstance} from 'fastify';
import type {WorkspaceRepository} from './contracts.js';
import {CONTROL_ORG} from './openai-control.js';
import {randomUUID} from 'node:crypto';
import {digest} from './knowledge.js';
/** Physically removes expired manual real-data runs and their evaluations.
 * Audit policy (same as RETENTION_PURGE): audit rows are NEVER deleted. They hold ids, hashes and
 * redacted reasons only; the purge appends one audit with a tombstone digest of the removed snapshots. */
export async function purgeExpiredManualRuns(repo:WorkspaceRepository,orgId:string,now=Date.now()) {
    if(orgId!==CONTROL_ORG)throw Error('MANUAL_RETENTION_TENANT_DENIED');
    const state=await repo.read(orgId);
    if(!state.runs.some(r=>r.manualRetention&&Date.parse(r.manualRetention.expiresAt)<=now))return {deleted:0,tombstoneHash:null};
    return repo.mutate(orgId,s=>{
        const expired=s.runs.filter(r=>r.manualRetention&&Date.parse(r.manualRetention.expiresAt)<=now),ids=new Set(expired.map(r=>r.id));
        if(!ids.size)return {deleted:0,tombstoneHash:null};
        s.runs=s.runs.filter(r=>!ids.has(r.id));s.evaluations=s.evaluations.filter(e=>!ids.has(e.runId));
        const tombstoneHash=digest(expired.map(r=>r.snapshotHash).sort().join('\n'));
        s.audits.push({id:randomUUID(),orgId,actorId:'system-retention',action:'MANUAL_RETENTION_PURGE',resourceId:'manual-retention',at:new Date(now).toISOString(),details:{deleted:ids.size,runIds:[...ids].sort(),tombstoneHash}});
        return {deleted:ids.size,tombstoneHash};
    });
}
export async function registerManualRetention(app:FastifyInstance,repo:WorkspaceRepository,orgId:string) {
    let running=false;
    const tick=async()=>{if(running)return;running=true;try{await purgeExpiredManualRuns(repo,orgId);}catch{app.log.warn('AI_QC_MANUAL_RETENTION_UNAVAILABLE');}finally{running=false;}};
    await tick();const timer=setInterval(()=>void tick(),60000);timer.unref();
    app.addHook('onClose',async()=>clearInterval(timer));
}
