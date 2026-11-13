import type {MonitoringRepository} from './contracts.js';
import {MONITORING_LIMITS} from './retention.js';
export async function monitoringHealth(store:MonitoringRepository,orgId:string,enabled:boolean,heartbeat:number|null,at=Date.now()){
 const s=await store.read(orgId),counts:Record<string,number>={};for(const j of s.jobs)counts[j.state]=(counts[j.state]??0)+1;
 const pending=s.jobs.filter(j=>['PENDING','RETRY','PROCESSING'].includes(j.state));
 return {enabled,syntheticOnly:true,provider:'mock',counts,heartbeat,oldestPendingMs:pending.length?Math.max(...pending.map(j=>at-j.createdAt)):0,retryAttempts:s.jobs.reduce((n,j)=>n+Math.max(0,j.attempts-1),0),deadLetters:counts.DEAD??0,openWarnings:s.warnings.filter(w=>w.status==='OPEN').length,notificationPending:s.deliveries.filter(d=>!d.delivered).length,employeeScoring:'DISABLED',violationConfirmation:'DISABLED',capacity:{limits:MONITORING_LIMITS,used:{jobs:s.jobs.length,warnings:s.warnings.length},atCapacity:s.jobs.length>=MONITORING_LIMITS.jobs||s.warnings.length>=MONITORING_LIMITS.warnings}};
}
