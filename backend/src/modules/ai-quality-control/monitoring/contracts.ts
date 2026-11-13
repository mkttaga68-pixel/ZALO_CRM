import type { Actor, AnalysisRun, Conversation } from '../contracts.js';
export const WARNING_TYPES = ['CONDUCT_NEEDS_REVIEW','UNANSWERED_CONVERSATION','SLA_BREACH','CUSTOMER_CARE_OVERDUE','UNRESOLVED_REQUEST','INSUFFICIENT_EVIDENCE'] as const;
export type WarningType = typeof WARNING_TYPES[number];
export interface MonitoringJob {
 id:string;orgId:string;key:string;sourceHash:string;actor:Actor;conversation:Conversation;kind:'MESSAGE'|'SLA_DUE';
 state:'PENDING'|'PROCESSING'|'RETRY'|'DONE'|'DEAD';attempts:number;generation:number;dueAt:number;leaseUntil:number;createdAt:number;updatedAt:number;error:string|null;runIds:string[];
}
export interface MonitoringWarning {
 id:string;orgId:string;jobId:string;conversationId:string;createdBy:string;category:WarningType;
 employeeId:string|null;messageIds:string[];evidence:AnalysisRun;evidenceHash:string;coverage:string;missingContext:string[];
 createdAt:number;updatedAt:number;status:'OPEN'|'ACKNOWLEDGED'|'DISMISSED';version:number;
 reviews:Array<{actorId:string;at:number;status:string;reason:string}>;
}
export interface MonitoringDelivery {id:string;orgId:string;warningId:string;delivered:boolean;createdAt:number;acknowledgedBy?:string[]}
export interface MonitoringState {jobs:MonitoringJob[];warnings:MonitoringWarning[];deliveries:MonitoringDelivery[]}
export interface MonitoringRepository {
 read(orgId:string):Promise<MonitoringState>;
 mutate<T>(orgId:string,fn:(state:MonitoringState)=>T):Promise<T>;
}
export interface MonitoringSettings {enabled:boolean;syntheticOnly:true;leaseMs:number;maxAttempts:number;backoffMs:number;pollMs:number}
export type ResolveActor=(id:string,orgId:string)=>Promise<Actor>;
