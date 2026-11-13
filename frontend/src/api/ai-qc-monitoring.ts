import {api} from './index';
import type {QcRun} from './ai-quality-control';
export interface MonitoringWarning {id:string;orgId:string;conversationId:string;category:string;employeeId:string|null;messageIds:string[];evidenceHash:string;evidence?:QcRun;coverage:string;missingContext:string[];createdAt:number;updatedAt:number;status:string;version:number;reviews:Array<{actorId:string;at:number;status:string;reason:string}>}
export interface MonitoringHealth {enabled:boolean;syntheticOnly:boolean;provider:string;counts:Record<string,number>;heartbeat:number|null;oldestPendingMs:number;retryAttempts:number;deadLetters:number;openWarnings:number;notificationPending:number}
export const monitoringApi={
 list:async()=> (await api.get<{enabled:boolean;syntheticOnly:boolean;warnings:MonitoringWarning[];open:number}>('/ai-quality-control/monitoring/warnings')).data,
 health:async()=> (await api.get<MonitoringHealth>('/ai-quality-control/monitoring/health')).data,
 detail:async(id:string)=> (await api.get<MonitoringWarning>('/ai-quality-control/monitoring/warnings/'+encodeURIComponent(id))).data,
 review:async(id:string,version:number,status:string,reason:string)=> (await api.post<MonitoringWarning>('/ai-quality-control/monitoring/warnings/'+encodeURIComponent(id)+'/review',{version,status,reason})).data,
};
