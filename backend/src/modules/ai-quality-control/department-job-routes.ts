import {randomUUID} from 'node:crypto';
import type {FastifyInstance, FastifyRequest} from 'fastify';
import {Prisma} from '@prisma/client';
import {prisma} from '../../shared/database/prisma-client.js';
import {QcError, demand, type Actor, type WorkspaceRepository} from './contracts.js';
import {assertDepartmentScanEnabled} from './department-monitoring-validation.js';
import {departmentScanPaused, readDepartmentScanConfig} from './department-monitoring-config.js';
import {ollamaAdmission} from './ollama-provider.js';

type Job = {id:string;conversation_id:string;state:string;error_code:string|null;attempts:number;created_at:Date;updated_at:Date;config_version:string};
const recoverable = (code:string|null) => !!code && /^(OLLAMA_(RESOURCE_LIMIT|QUEUE_FULL|QUEUE_TIMEOUT|CIRCUIT_OPEN|TIMEOUT|INVALID_OR_UNAVAILABLE)|AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED|CONTINUOUS_SERVICE_UNAVAILABLE)$/.test(code);

export async function registerDepartmentJobRoutes(app:FastifyInstance, deps:{
  actor:(request:FastifyRequest)=>Promise<Actor>;
  repo:WorkspaceRepository;
  enabled:()=>boolean;
  authorizeConversation:(actor:Actor,id:string,request:FastifyRequest)=>Promise<unknown>;
}) {
  const prefix='/api/v1/ai-quality-control/department-monitoring/departments/:id/jobs';
  const wrap=(fn:(request:FastifyRequest,actor:Actor,departmentId:string)=>Promise<unknown>)=>async(request:FastifyRequest,reply:any)=>{
    try {
      if(!deps.enabled())throw new QcError('AI_QC_DISABLED',503);
      const actor=await deps.actor(request);
      for(const action of ['access','edit','approve','view_all'] as const)demand(actor,action);
      if(!['owner','admin'].includes(request.user.role))throw new QcError('QC_ORG_ADMIN_REQUIRED',403);
      const id=(request.params as {id:string}).id;
      if(!await prisma.department.findFirst({where:{id,orgId:actor.orgId,archivedAt:null},select:{id:true}}))throw new QcError('DEPARTMENT_NOT_FOUND',404);
      return await fn(request,actor,id);
    }catch(e){return reply.code(e instanceof QcError?e.statusCode:503).send({error:e instanceof QcError?e.code:'DEPARTMENT_MONITORING_STORAGE_UNAVAILABLE'});}
  };
  app.get(prefix,wrap(async(request,actor,id)=>{
    const offset=Number((request.query as {offset?:string}).offset??0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>10000)throw new QcError('INVALID_BODY');
    const rows=await prisma.$queryRaw<Job[]>(Prisma.sql`SELECT id,conversation_id,state,error_code,attempts,created_at,updated_at,config_version::text
      FROM ai_qc_continuous_job WHERE org_id=${actor.orgId} AND department_id=${id} AND created_at>NOW()-INTERVAL '7 days'
      AND (state IN ('DEAD','RETRY','SKIPPED') OR error_code IS NOT NULL) ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ${offset}`);
    const items=[];
    for(const job of rows.slice(0,20)) {
      try{await deps.authorizeConversation(actor,job.conversation_id,request);}catch{continue;}
      items.push({id:job.id,state:job.state,errorCode:job.error_code,attempts:job.attempts,createdAt:job.created_at,updatedAt:job.updated_at,
        canRetry:job.state==='DEAD'&&recoverable(job.error_code)});
    }
    const state=await deps.repo.read(actor.orgId),day=new Date().toISOString().slice(0,10);
    const reserved=state.reservations.filter(r=>r.at.startsWith(day)).reduce((n,r)=>n+r.tokens,0);
    return {items,nextOffset:rows.length>20?offset+20:null,budget:{daily:state.settings.dailyTokenBudget,reserved,remaining:Math.max(0,state.settings.dailyTokenBudget-reserved)}};
  }));
  app.post(prefix+'/:jobId/retry',wrap(async(request,actor,id)=>{
    demand(actor,'create');
    const expected=(request.body as {expectedUpdatedAt?:unknown}|undefined)?.expectedUpdatedAt;
    if(typeof expected!=='string'||!Number.isFinite(Date.parse(expected)))throw new QcError('INVALID_BODY');
    const jobId=(request.params as {jobId:string}).jobId;
    const rows=await prisma.$queryRaw<Job[]>(Prisma.sql`SELECT id,conversation_id,state,error_code,attempts,created_at,updated_at,config_version::text FROM ai_qc_continuous_job
      WHERE org_id=${actor.orgId} AND department_id=${id} AND id=${jobId} AND created_at>NOW()-INTERVAL '7 days'`);
    const job=rows[0];
    if(!job)throw new QcError('RUN_NOT_FOUND',404);
    await deps.authorizeConversation(actor,job.conversation_id,request);
    if(job.state!=='DEAD'||!recoverable(job.error_code)||job.updated_at.toISOString()!==new Date(expected).toISOString())throw new QcError('AI_QC_JOB_CHANGED',409);
    const config=await readDepartmentScanConfig(actor.orgId,id);
    assertDepartmentScanEnabled(config,await departmentScanPaused(actor.orgId),job.config_version);
    const admission=await ollamaAdmission();if(!admission.ok)throw new QcError(admission.code,503);
    const state=await deps.repo.read(actor.orgId),day=new Date().toISOString().slice(0,10);
    const remaining=state.settings.dailyTokenBudget-state.reservations.filter(r=>r.at.startsWith(day)).reduce((n,r)=>n+r.tokens,0);
    if(remaining<=state.settings.maxOutputTokens+1024)throw new QcError('AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED',429);
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'aiqc-department-controls:'+actor.orgId},0))`);
      const changed=await tx.$executeRaw(Prisma.sql`UPDATE ai_qc_continuous_job j SET state='RETRY',attempts=0,generation=generation+1,due_at=NOW(),lease_until=NULL,updated_at=NOW()
        WHERE j.org_id=${actor.orgId} AND j.department_id=${id} AND j.id=${job.id} AND j.state='DEAD' AND date_trunc('milliseconds',j.updated_at)=${job.updated_at}
        AND EXISTS(SELECT 1 FROM ai_qc_department_monitor_config c WHERE c.org_id=j.org_id AND c.department_id=j.department_id AND c.version=j.config_version AND c.enabled AND c.continuous_enabled)
        AND NOT EXISTS(SELECT 1 FROM ai_qc_department_monitor_control ctl WHERE ctl.org_id=j.org_id AND ctl.paused)`);
      if(changed!==1)throw new QcError('AI_QC_JOB_CHANGED',409);
      await tx.$executeRaw(Prisma.sql`INSERT INTO ai_qc_department_monitor_audit(id,org_id,department_id,actor_user_id,action,changed_fields)
        VALUES(${randomUUID()},${actor.orgId},${id},${actor.id},'JOB_RETRY_REQUESTED',${JSON.stringify(['jobId:'+job.id])}::jsonb)`);
    });
    return {ok:true};
  }));
}
