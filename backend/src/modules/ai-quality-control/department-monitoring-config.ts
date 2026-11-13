import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../shared/database/prisma-client.js';
import { QcError, demand, type Actor, type WorkspaceRepository } from './contracts.js';
import { defaultSchedule, nextScheduleChange, scheduleActiveAt, validateSchedule, type DepartmentSchedule } from './department-schedule.js';
import { departmentEnableBlockers, validateDepartmentMonitorDraft, validateDepartmentToggle, type DepartmentScanConfig } from './department-monitoring-validation.js';

type ConfigRow = DepartmentScanConfig & { department_id: string; updated_at: Date };
type Tx = { $executeRaw(query: Prisma.Sql): Promise<number> };

export async function readDepartmentScanConfig(orgId: string, departmentId: string): Promise<DepartmentScanConfig> {
  const rows = await prisma.$queryRaw<ConfigRow[]>(Prisma.sql`SELECT enabled, version::text, analysis_types, recipient_user_ids, lookback_hours, max_conversations_per_run, approval_ref FROM ai_qc_department_monitor_config WHERE org_id=${orgId} AND department_id=${departmentId}`);
  if (!rows[0]) throw new QcError('DEPARTMENT_MONITOR_CONFIG_REQUIRED', 409);
  return rows[0];
}
export async function departmentScanPaused(orgId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{paused:boolean}>>(Prisma.sql`SELECT paused FROM ai_qc_department_monitor_control WHERE org_id=${orgId}`);
  return rows[0]?.paused ?? false;
}
async function audit(tx: Tx, actor: Actor, departmentId: string | null, action: string, fields: string[]) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO ai_qc_department_monitor_audit(id,org_id,department_id,actor_user_id,action,changed_fields) VALUES(${randomUUID()},${actor.orgId},${departmentId},${actor.id},${action},${JSON.stringify(fields)}::jsonb)`);
}
export async function registerDepartmentMonitoringConfigRoutes(app: FastifyInstance, deps: {
  actor: (request: FastifyRequest) => Promise<Actor>;
  repo: WorkspaceRepository;
  runtimeAvailable: (actor: Actor) => boolean;
  moduleAvailable: () => boolean;
}) {
  const prefix='/api/v1/ai-quality-control/department-monitoring';
  const admin=async(request:FastifyRequest)=>{
    if(!deps.moduleAvailable())throw new QcError('AI_QC_DISABLED',503);
    const actor=await deps.actor(request);demand(actor,'edit');demand(actor,'approve');
    if(!['owner','admin'].includes(request.user.role))throw new QcError('QC_ORG_ADMIN_REQUIRED',403);
    return actor;
  };
  const wrap=(fn:(r:FastifyRequest,a:Actor)=>Promise<unknown>)=>async(request:FastifyRequest,reply:any)=>{
    try{return await fn(request,await admin(request));}catch(error){
      const schema=(error as {meta?:{code?:string}})?.meta?.code==='42P01';
      return reply.code(error instanceof QcError?error.statusCode:503).send({error:error instanceof QcError?error.code:schema?'AI_QC_SCHEMA_NOT_READY':'DEPARTMENT_MONITORING_STORAGE_UNAVAILABLE'});
    }
  };
  const department=async(actor:Actor,id:string)=>{
    if(!await prisma.department.findFirst({where:{id,orgId:actor.orgId,archivedAt:null},select:{id:true}}))throw new QcError('DEPARTMENT_NOT_FOUND',404);
  };
  app.get(prefix,wrap(async(_request,actor)=>{
    const [departments,configs,users,paused,workspace]=await Promise.all([
      prisma.department.findMany({where:{orgId:actor.orgId,archivedAt:null},select:{id:true,name:true,parentId:true,_count:{select:{members:true}}},orderBy:[{displayOrder:'asc'},{name:'asc'}]}),
      prisma.$queryRaw<Array<ConfigRow & {continuous_enabled:boolean}>>(Prisma.sql`SELECT department_id,enabled,continuous_enabled,version::text,analysis_types,recipient_user_ids,lookback_hours,max_conversations_per_run,approval_ref,updated_at FROM ai_qc_department_monitor_config WHERE org_id=${actor.orgId}`),
      prisma.user.findMany({where:{orgId:actor.orgId,isActive:true},select:{id:true,fullName:true,email:true},take:500}),
      departmentScanPaused(actor.orgId),deps.repo.read(actor.orgId),
    ]);
    const schedules=new Map((await prisma.$queryRaw<Array<DepartmentSchedule&{department_id:string}>>(Prisma.sql`SELECT department_id,enabled,days,windows,timezone FROM ai_qc_department_schedule WHERE org_id=${actor.orgId}`)).map(s=>[s.department_id,{enabled:s.enabled,days:s.days,windows:s.windows,timezone:s.timezone}]));
    const now=new Date();
    const byId=new Map(configs.map(c=>[c.department_id,c]));const available=deps.runtimeAvailable(actor);
    const automatic=available&&process.env.AI_QC_CONTINUOUS_LOCAL_ENABLED==='true';
    const jobs=automatic?await prisma.$queryRaw<Array<{department_id:string;state:string;count:number;error_code:string|null}>>(Prisma.sql`SELECT department_id,state,count(*)::int AS count,max(error_code) AS error_code FROM ai_qc_continuous_job WHERE org_id=${actor.orgId} AND created_at>NOW()-INTERVAL '7 days' GROUP BY department_id,state`):[];
    return {enabled:available,runtimeAvailable:available,automatic,killSwitchActive:paused,users:users.map(u=>({id:u.id,name:u.fullName||u.email})),
      departments:departments.map(d=>{const c=byId.get(d.id);return {id:d.id,name:d.name,parentId:d.parentId,memberCount:d._count.members,enabled:c?.enabled??false,version:c?.version??'0',analysisTypes:c?.analysis_types??[],recipientUserIds:c?.recipient_user_ids??[],lookbackHours:c?.lookback_hours??24,maxConversationsPerRun:c?.max_conversations_per_run??100,approvalRef:c?.approval_ref??'',updatedAt:c?.updated_at??null,
        continuousEnabled:c?.continuous_enabled??false,
        ...(()=>{const schedule=schedules.get(d.id)??defaultSchedule();return {schedule,scheduleActive:scheduleActiveAt(schedule,now),scheduleNextChangeAt:nextScheduleChange(schedule,now)?.toISOString()??null};})(),jobs:jobs.filter(j=>j.department_id===d.id),blockers:departmentEnableBlockers(c,workspace,actor.orgId,d.id,available)};}),
    };
  }));
  app.put(prefix+'/departments/:id',wrap(async(request,actor)=>{
    const id=(request.params as {id:string}).id;await department(actor,id);
    const c=validateDepartmentMonitorDraft(request.body);
    if(c.recipientUserIds.length!==await prisma.user.count({where:{id:{in:c.recipientUserIds},orgId:actor.orgId,isActive:true}}))throw new QcError('ALERT_RECIPIENT_NOT_IN_TENANT',403);
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'aiqc-department-controls:'+actor.orgId},0))`);
      // Editing the scope switches AI off and invalidates old previews.
      await tx.$executeRaw(Prisma.sql`INSERT INTO ai_qc_department_monitor_config(org_id,department_id,enabled,analysis_types,recipient_user_ids,lookback_hours,max_conversations_per_run,approval_ref,updated_by)
        VALUES(${actor.orgId},${id},FALSE,${JSON.stringify(c.analysisTypes)}::jsonb,${JSON.stringify(c.recipientUserIds)}::jsonb,${c.lookbackHours},${c.maxConversationsPerRun},${c.approvalRef||null},${actor.id})
        ON CONFLICT(org_id,department_id) DO UPDATE SET enabled=FALSE,continuous_enabled=FALSE,version=ai_qc_department_monitor_config.version+1,analysis_types=EXCLUDED.analysis_types,recipient_user_ids=EXCLUDED.recipient_user_ids,lookback_hours=EXCLUDED.lookback_hours,max_conversations_per_run=EXCLUDED.max_conversations_per_run,approval_ref=EXCLUDED.approval_ref,updated_by=EXCLUDED.updated_by,updated_at=NOW()`);
      await audit(tx,actor,id,'CONFIG_SAVED_AI_OFF',Object.keys(c));
    });
    return {ok:true,enabled:false};
  }));
  // Timeset: không đổi version/công tắc chính, nên không làm mất hàng đợi hay quét lại tin cũ.
  app.put(prefix+'/departments/:id/schedule',wrap(async(request,actor)=>{
    const id=(request.params as {id:string}).id;await department(actor,id);
    const s=validateSchedule(request.body);
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`INSERT INTO ai_qc_department_schedule(org_id,department_id,enabled,days,windows,timezone,updated_by) VALUES(${actor.orgId},${id},${s.enabled},${JSON.stringify(s.days)}::jsonb,${JSON.stringify(s.windows)}::jsonb,${s.timezone},${actor.id})
        ON CONFLICT(org_id,department_id) DO UPDATE SET enabled=EXCLUDED.enabled,days=EXCLUDED.days,windows=EXCLUDED.windows,updated_by=EXCLUDED.updated_by,updated_at=NOW()`);
      await audit(tx,actor,id,s.enabled?'SCHEDULE_SAVED':'SCHEDULE_DISABLED',['enabled','days','windows']);
    });
    const now=new Date();
    return {ok:true,schedule:s,scheduleActive:scheduleActiveAt(s,now),scheduleNextChangeAt:nextScheduleChange(s,now)?.toISOString()??null};
  }));
  app.put(prefix+'/departments/:id/enabled',wrap(async(request,actor)=>{
    const id=(request.params as {id:string}).id;await department(actor,id);
    const input=validateDepartmentToggle(request.body),c=await readDepartmentScanConfig(actor.orgId,id);
    if(c.version!==input.version)throw new QcError('DEPARTMENT_CONFIGURATION_CHANGED',409);
    const continuous=input.enabled&&process.env.AI_QC_CONTINUOUS_LOCAL_ENABLED==='true';
    const principal=continuous?await prisma.user.findFirst({where:{id:actor.id,orgId:actor.orgId,isActive:true},select:{passwordHash:true}}):null;
    if(continuous&&!principal)throw new QcError('QC_FORBIDDEN',403);
    const epoch=principal?createHash('sha256').update(principal.passwordHash).digest('hex'):null;
    if(input.enabled){
      demand(actor,'create');demand(actor,'view_all');
      if(await departmentScanPaused(actor.orgId))throw new QcError('DEPARTMENT_LOCAL_TEST_KILL_SWITCH_ACTIVE',423);
      const blockers=departmentEnableBlockers(c,await deps.repo.read(actor.orgId),actor.orgId,id,deps.runtimeAvailable(actor));
      if(blockers.length)throw new QcError(blockers[0]!,409);
      if(c.recipient_user_ids.length!==await prisma.user.count({where:{id:{in:c.recipient_user_ids},orgId:actor.orgId,isActive:true}}))throw new QcError('ALERT_RECIPIENT_NOT_IN_TENANT',403);
    }
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'aiqc-department-controls:'+actor.orgId},0))`);
      if(input.enabled){const paused=await tx.$queryRaw<Array<{paused:boolean}>>(Prisma.sql`SELECT paused FROM ai_qc_department_monitor_control WHERE org_id=${actor.orgId}`);if(paused[0]?.paused)throw new QcError('DEPARTMENT_LOCAL_TEST_KILL_SWITCH_ACTIVE',423);}
      const changed=await tx.$executeRaw(Prisma.sql`UPDATE ai_qc_department_monitor_config SET enabled=${input.enabled},continuous_enabled=${continuous},activated_at=NOW(),principal_epoch=${epoch},version=version+1,updated_by=${actor.id},updated_at=NOW() WHERE org_id=${actor.orgId} AND department_id=${id} AND version=${input.version}::bigint`);
      if(changed!==1)throw new QcError('DEPARTMENT_CONFIGURATION_CHANGED',409);
      await audit(tx,actor,id,input.enabled?'AI_ENABLED':'AI_DISABLED',['enabled','version']);
    });
    return {ok:true,enabled:input.enabled};
  }));
  const control=async(request:FastifyRequest,actor:Actor,paused:boolean)=>{
    const body=request.body as {reason?:unknown}|undefined;
    if(typeof body?.reason!=='string'||!body.reason.trim()||body.reason.length>500)throw new QcError('KILL_SWITCH_REASON_REQUIRED');
    const reasonHash=createHash('sha256').update(body.reason.trim()).digest('hex');
    await prisma.$transaction(async tx=>{
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'aiqc-department-controls:'+actor.orgId},0))`);
      await tx.$executeRaw(Prisma.sql`INSERT INTO ai_qc_department_monitor_control(org_id,paused,updated_by) VALUES(${actor.orgId},${paused},${actor.id}) ON CONFLICT(org_id) DO UPDATE SET paused=EXCLUDED.paused,version=ai_qc_department_monitor_control.version+1,updated_by=EXCLUDED.updated_by,updated_at=NOW()`);
      if(paused)await tx.$executeRaw(Prisma.sql`UPDATE ai_qc_department_monitor_config SET enabled=FALSE,continuous_enabled=FALSE,version=version+1,updated_by=${actor.id},updated_at=NOW() WHERE org_id=${actor.orgId}`);
      await audit(tx,actor,null,paused?'EMERGENCY_STOP':'EMERGENCY_STOP_CLEARED',['paused','reasonSha256:'+reasonHash]);
    });
    return {ok:true,killSwitchActive:paused};
  };
  app.post(prefix+'/kill-switch',wrap((r,a)=>control(r,a,true)));
  app.post(prefix+'/resume',wrap((r,a)=>control(r,a,false)));
}
