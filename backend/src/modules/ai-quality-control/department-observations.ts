import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { QcError, demand, type Actor, type AnalysisRun, type Workspace, type WorkspaceRepository } from './contracts.js';
import { audit } from './knowledge.js';
import { canObserveDepartmentRun, observationResult } from './observation-presentation.js';

export async function registerDepartmentObservations(app:FastifyInstance,deps:{repo:WorkspaceRepository;actor:(request:FastifyRequest)=>Promise<Actor>;enabled:()=>boolean;authorizeConversation:(actor:Actor,id:string,request:FastifyRequest)=>Promise<unknown>}) {
  const prefix='/api/v1/ai-quality-control/department-observations';
  const visible=async(actor:Actor,state:Workspace,run:AnalysisRun,request:FastifyRequest)=>{
    const departmentId=run.departmentObservation?.departmentId;
    if(!departmentId)return false;
    const configs=await prisma.$queryRaw<Array<{recipient_user_ids:string[]}>>(Prisma.sql`SELECT c.recipient_user_ids FROM ai_qc_department_monitor_config c JOIN departments d ON d.id=c.department_id AND d.org_id=c.org_id WHERE c.org_id=${actor.orgId} AND c.department_id=${departmentId} AND d.archived_at IS NULL`);
    if(!canObserveDepartmentRun(actor,state,run,configs[0]?.recipient_user_ids??[]))return false;
    try{await deps.authorizeConversation(actor,run.conversation.id,request);return true;}catch{return false;}
  };
  const names=async(actor:Actor,runs:AnalysisRun[])=>{
    const ids=[...new Set(runs.flatMap(r=>r.conversation.messages.filter(m=>m.role==='HUMAN'&&m.attribution==='VERIFIED').map(m=>m.actorId).filter((id):id is string=>!!id)))];
    return Object.fromEntries((await prisma.user.findMany({where:{orgId:actor.orgId,id:{in:ids}},select:{id:true,fullName:true}})).map(u=>[u.id,u.fullName]));
  };
  const wrap=(fn:(request:FastifyRequest,actor:Actor)=>Promise<unknown>)=>async(request:FastifyRequest,reply:any)=>{
    try{if(!deps.enabled())throw new QcError('AI_QC_DISABLED',503);const actor=await deps.actor(request);demand(actor,'access');return await fn(request,actor);}catch(e){return reply.code(e instanceof QcError?e.statusCode:503).send({error:e instanceof QcError?e.code:'OBSERVATIONS_UNAVAILABLE'});}
  };
  app.get(prefix,wrap(async(request,actor)=>{
    const state=await deps.repo.read(actor.orgId),runs:AnalysisRun[]=[];
    for(const run of [...state.runs].reverse().filter(r=>r.departmentObservation&&r.status==='COMPLETED'&&r.output.findings.some(f=>f.status==='POTENTIAL_ISSUE')).slice(0,100))if(await visible(actor,state,run,request))runs.push(run);
    const employeeNames=await names(actor,runs);
    return {items:runs.slice(0,30).map(r=>({id:r.id,createdAt:r.createdAt,reviewStatus:r.reviewStatus,unread:!r.departmentObservation!.seenBy.includes(actor.id),employees:observationResult(r,employeeNames).findings.filter(f=>f.status==='POTENTIAL_ISSUE').flatMap(f=>f.employees).filter((v,i,a)=>a.findIndex(e=>e.id===v.id)===i),types:r.output.findings.filter(f=>f.status==='POTENTIAL_ISSUE').map(f=>f.type)})),unread:runs.filter(r=>!r.departmentObservation!.seenBy.includes(actor.id)).length,coverage:'LATEST_100_RUNS_MAX_30_DISPLAYED'};
  }));
  app.get(prefix+'/:id',wrap(async(request,actor)=>{
    const state=await deps.repo.read(actor.orgId),run=state.runs.find(r=>r.id===(request.params as {id:string}).id);
    if(!run||!await visible(actor,state,run,request))throw new QcError('RUN_NOT_FOUND',404);
    return observationResult(run,await names(actor,[run]));
  }));
  app.post(prefix+'/:id/seen',wrap(async(request,actor)=>{
    const state=await deps.repo.read(actor.orgId),run=state.runs.find(r=>r.id===(request.params as {id:string}).id);
    if(!run||!await visible(actor,state,run,request))throw new QcError('RUN_NOT_FOUND',404);
    return deps.repo.mutate(actor.orgId,s=>{const current=s.runs.find(r=>r.id===run.id);if(!current?.departmentObservation)throw new QcError('RUN_NOT_FOUND',404);
      if(!current.departmentObservation.seenBy.includes(actor.id)){current.departmentObservation.seenBy.push(actor.id);audit(s,actor,'DEPARTMENT_OBSERVATION_SEEN',run.id);}
      return {ok:true};});
  }));
}
