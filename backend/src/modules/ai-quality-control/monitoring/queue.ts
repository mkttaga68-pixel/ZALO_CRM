import {clone,QcError} from '../contracts.js';
import type {MonitoringRepository,MonitoringSettings,MonitoringJob} from './contracts.js';
export class MonitoringQueue {
 constructor(readonly store:MonitoringRepository,readonly settings:MonitoringSettings,readonly clock=Date.now){}
 async claim(orgId:string){if(!this.settings.enabled)return null;const at=this.clock();return this.store.mutate(orgId,s=>{
  const job=s.jobs.filter(j=>((j.state==='PENDING'||j.state==='RETRY')&&j.dueAt<=at)||(j.state==='PROCESSING'&&j.leaseUntil<=at)).sort((a,b)=>a.createdAt-b.createdAt)[0];if(!job)return null;
  if(job.attempts>=this.settings.maxAttempts){job.state='DEAD';job.error='LEASE_ATTEMPTS_EXHAUSTED';job.updatedAt=at;return null;}
  job.state='PROCESSING';job.attempts++;job.generation++;job.leaseUntil=at+this.settings.leaseMs;job.updatedAt=at;return clone(job);
 });}
 async fail(job:MonitoringJob,code:string,terminal=false){await this.store.mutate(job.orgId,s=>{const current=s.jobs.find(j=>j.id===job.id);if(!current||current.state!=='PROCESSING'||current.generation!==job.generation||current.leaseUntil<=this.clock())return;
  current.error=code;current.updatedAt=this.clock();current.state=terminal||current.attempts>=this.settings.maxAttempts?'DEAD':'RETRY';current.dueAt=this.clock()+this.settings.backoffMs*2**(current.attempts-1);current.leaseUntil=0;
 });}
 assertLease(current:MonitoringJob|undefined,job:MonitoringJob){if(!current||current.state!=='PROCESSING'||current.generation!==job.generation||current.leaseUntil<=this.clock())throw new QcError('MONITORING_STALE_LEASE',409);}
}
