import {createHash} from 'node:crypto';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {Server,Socket} from 'socket.io';
import {Prisma} from '@prisma/client';
import {prisma} from '../../shared/database/prisma-client.js';
import {userHasGrant} from '../rbac/permission-group-service.js';
import {assertActiveSession} from '../auth/active-session.js';
import {QcError,demand,type Actor,type Conversation,type WorkspaceRepository} from './contracts.js';
import {ConversationAnalyzerService} from './analysis.js';
import {AIProviderService,type ProviderEnvironment} from './providers.js';
import {CrmConversationReadAdapter} from './crm-adapter.js';
import {departmentEnableBlockers,assertDepartmentScanEnabled,type DepartmentScanConfig} from './department-monitoring-validation.js';
import {departmentScanPaused} from './department-monitoring-config.js';
import {issueContinuousAuthority} from './continuous-authorization.js';
import {scopedDepartmentConversation} from './department-scan-scope.js';
import {sourceFingerprint} from './manual-real-consent.js';
import {canObserveDepartmentRun} from './observation-presentation.js';
import {scheduleSqlPredicate} from './department-schedule.js';

interface Config extends DepartmentScanConfig {org_id:string;department_id:string;updated_by:string;principal_epoch:string|null;continuous_enabled:boolean}
interface Job {id:string;org_id:string;department_id:string;config_version:string;message_id:string;conversation_id:string;employee_id:string;attempts:number;generation:number;run_id:string|null}
export function continuousRetry(code:string,attempt:number):{terminal:boolean;delay:number}{
  const retry=/^OLLAMA_|BUDGET|RATE_|CAPACITY|UNAVAILABLE|PROVIDER|KNOWLEDGE_AUTHORITY_CHANGED/.test(code);
  const permanent=!retry||attempt>=5;
  return {terminal:permanent,delay:Math.min(300000,15000*2**Math.max(0,attempt-1))};
}
export async function registerContinuousLocal(app:FastifyInstance,repo:WorkspaceRepository,environment:ProviderEnvironment,adapter:CrmConversationReadAdapter){
  if(process.env.AI_QC_CONTINUOUS_LOCAL_ENABLED!=='true')return;
  if(process.env.AI_QC_DEPLOYMENT_TIER!=='local-test'||!environment.enabled||!environment.ollamaRealData||!environment.openAiRemoved||!environment.realDataOrgId)throw new QcError('CONTINUOUS_CONFIGURATION_INVALID',503);
  const orgId=environment.realDataOrgId;
  const exists=await prisma.$queryRaw<Array<{ready:boolean}>>(Prisma.sql`SELECT to_regclass('public.ai_qc_continuous_job') IS NOT NULL AS ready`);
  if(!exists[0]?.ready)throw new QcError('CONTINUOUS_SCHEMA_REQUIRED',503);
  const io=(app as FastifyInstance & {io:Server}).io;
  const namespace=io.of('/aiqc-observers');
  const resolve=async(id:string)=>{
    const user=await prisma.user.findFirst({where:{id,orgId,isActive:true},select:{id:true,orgId:true,role:true,email:true,passwordHash:true}});
    if(!user)throw new QcError('CONTINUOUS_PRINCIPAL_REVOKED',403);
    const permissions:Actor['permissions']=[];for(const action of ['access','create','edit','approve','view_all'] as const)if(await userHasGrant(id,'ai_quality_control',action))permissions.push(action);
    const memberships=await prisma.departmentMember.findMany({where:{userId:id,department:{orgId,archivedAt:null}},select:{departmentId:true}});
    const actor:Actor={id,orgId,permissions,departmentIds:memberships.map(m=>m.departmentId)};
    // Background principal has no browser/PIN session. Main/private nick contents remain inaccessible.
    const request={user:{id,orgId,role:user.role,email:user.email},headers:{},cookies:{},method:'GET',url:'/internal/aiqc-continuous',server:app,log:app.log} as unknown as FastifyRequest;
    return {actor,request,user};
  };
  const socketActor=async(socket:Socket)=>{
    const token=socket.handshake.auth?.token;if(typeof token!=='string')throw new QcError('UNAUTHORIZED',401);
    const claims=app.jwt.verify<{id:string;orgId:string;role:string;credentialVersion:string}>(token);await assertActiveSession(claims);
    if(claims.orgId!==orgId)throw new QcError('QC_FORBIDDEN',403);
    const principal=await resolve(claims.id);demand(principal.actor,'access');return principal;
  };
  namespace.use((socket,next)=>{void socketActor(socket).then(()=>next()).catch(()=>next(Error('UNAUTHORIZED')));});
  namespace.on('connection',socket=>{
    const timer=setInterval(()=>{void socketActor(socket).catch(()=>socket.disconnect(true));},30000);timer.unref();socket.once('disconnect',()=>clearInterval(timer));
  });
  const config=async(departmentId:string)=>{
    const rows=await prisma.$queryRaw<Config[]>(Prisma.sql`SELECT c.*,c.version::text AS version FROM ai_qc_department_monitor_config c JOIN departments d ON d.id=c.department_id AND d.org_id=c.org_id WHERE c.org_id=${orgId} AND c.department_id=${departmentId} AND d.archived_at IS NULL`);
    const c=rows[0];if(!c||!c.continuous_enabled)throw new QcError('CONTINUOUS_DISABLED',409);assertDepartmentScanEnabled(c,await departmentScanPaused(orgId));return c;
  };
  const load=async(job:Job,principal:Awaited<ReturnType<typeof resolve>>,c:Config):Promise<Conversation>=>{
    const member=await prisma.departmentMember.findFirst({where:{departmentId:job.department_id,userId:job.employee_id,department:{orgId,archivedAt:null},user:{orgId,isActive:true}},select:{joinedAt:true}});
    const target=await prisma.message.findFirst({where:{id:job.message_id,conversationId:job.conversation_id,isDeleted:false,senderType:'self',sentVia:'user',repliedByUserId:job.employee_id,conversation:{orgId}},select:{sentAt:true,createdAt:true}});
    if(!member||!target||target.createdAt<member.joinedAt)throw new QcError('CONTINUOUS_MEMBERSHIP_OR_MESSAGE_CHANGED',409);
    const all=await adapter.loadAt(principal.actor,job.conversation_id,principal.request,target.sentAt);
    const members=await prisma.departmentMember.findMany({where:{departmentId:job.department_id,department:{orgId},user:{orgId,isActive:true}},select:{userId:true}});
    const scoped=scopedDepartmentConversation(all,job.department_id,new Set(members.map(m=>m.userId)),c.lookback_hours);
    if(!scoped||!scoped.messages.some(m=>m.id===job.message_id))throw new QcError('CONTINUOUS_TARGET_OUTSIDE_CONTEXT',409);
    scoped.provenanceHash=createHash('sha256').update(JSON.stringify({version:c.version,memberIds:members.map(m=>m.userId).sort(),target:job.message_id})).digest('hex');return scoped;
  };
  const discover=async()=>{
    if(await departmentScanPaused(orgId))return;
    // Queue only identifiers after the explicit opt-in. Idempotency also discovers committed late rows on the next poll.
    await prisma.$executeRaw(Prisma.sql`INSERT INTO ai_qc_continuous_job(id,org_id,department_id,config_version,message_id,conversation_id,employee_id)
      SELECT 'cq-'||md5(c.org_id||c.department_id||c.version::text||m.id),c.org_id,c.department_id,c.version,m.id,m.conversation_id,m.replied_by_user_id
      FROM ai_qc_department_monitor_config c JOIN departments d ON d.id=c.department_id AND d.org_id=c.org_id
      JOIN department_members dm ON dm.department_id=c.department_id JOIN users u ON u.id=dm.user_id AND u.org_id=c.org_id AND u.is_active
      JOIN messages m ON m.replied_by_user_id=u.id JOIN conversations v ON v.id=m.conversation_id AND v.org_id=c.org_id
      LEFT JOIN ai_qc_department_schedule s ON s.org_id=c.org_id AND s.department_id=c.department_id
      WHERE c.org_id=${orgId} AND c.enabled AND c.continuous_enabled AND d.archived_at IS NULL
      AND ${scheduleSqlPredicate('s','m.created_at')}
      AND m.created_at>=GREATEST(c.activated_at,dm.joined_at,NOW()-INTERVAL '7 days') AND m.sender_type='self' AND m.sent_via='user' AND NOT m.is_deleted
      AND NOT EXISTS(SELECT 1 FROM ai_qc_continuous_job j WHERE j.org_id=c.org_id AND j.department_id=c.department_id AND j.config_version=c.version AND j.message_id=m.id)
      AND (SELECT count(*) FROM ai_qc_continuous_job j WHERE j.org_id=${orgId} AND j.state IN ('PENDING','RETRY','PROCESSING'))<5000
      ORDER BY m.created_at,m.id LIMIT 50 ON CONFLICT DO NOTHING`);
  };
  const claim=async()=>{
    const jobs=await prisma.$queryRaw<Job[]>(Prisma.sql`UPDATE ai_qc_continuous_job SET state='PROCESSING',attempts=attempts+1,generation=generation+1,lease_until=NOW()+INTERVAL '5 minutes',updated_at=NOW()
      WHERE id=(SELECT id FROM ai_qc_continuous_job WHERE org_id=${orgId} AND attempts<5 AND ((state IN ('PENDING','RETRY') AND due_at<=NOW()) OR (state='PROCESSING' AND lease_until<NOW())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id,org_id,department_id,config_version::text,message_id,conversation_id,employee_id,attempts,generation,run_id`);
    return jobs[0];
  };
  const notify=async()=>{
    const jobs=await prisma.$queryRaw<Job[]>(Prisma.sql`SELECT id,run_id,department_id FROM ai_qc_continuous_job WHERE org_id=${orgId} AND state='DONE' AND NOT notified LIMIT 20`);
    if(!jobs.length)return;
    const state=await repo.read(orgId);
    for(const job of jobs){const run=state.runs.find(r=>r.id===job.run_id);
      if(run?.status==='COMPLETED'&&run.output.findings.some(f=>f.status==='POTENTIAL_ISSUE')){
        const rows=await prisma.$queryRaw<Array<{recipient_user_ids:string[]}>>(Prisma.sql`SELECT c.recipient_user_ids FROM ai_qc_department_monitor_config c JOIN departments d ON d.id=c.department_id AND d.org_id=c.org_id WHERE c.org_id=${orgId} AND c.department_id=${job.department_id} AND d.archived_at IS NULL`);
        for(const socket of namespace.sockets.values())try{
          const receiver=await socketActor(socket);
          if(!canObserveDepartmentRun(receiver.actor,state,run,rows[0]?.recipient_user_ids??[]))continue;
          await adapter.load(receiver.actor,run.conversation.id,receiver.request);
          socket.emit('aiqc:observations-changed',{});
        }catch{ /* A missing conversation grant is not a transport authorization error. Never broadcast evidence. */ }
      }
      await prisma.$executeRaw(Prisma.sql`UPDATE ai_qc_continuous_job SET notified=TRUE WHERE id=${job.id} AND org_id=${orgId}`);
    }
  };
  const processJob=async(job:Job)=>{
    try{
      const c=await config(job.department_id);assertDepartmentScanEnabled(c,false,job.config_version);
      const principal=await resolve(c.updated_by);
      if(!['owner','admin'].includes(principal.user.role)||createHash('sha256').update(principal.user.passwordHash).digest('hex')!==c.principal_epoch)throw new QcError('CONTINUOUS_PRINCIPAL_REVOKED',403);
      for(const action of ['create','edit','approve','view_all'] as const)demand(principal.actor,action);
      const blockers=departmentEnableBlockers(c,await repo.read(orgId),orgId,c.department_id,true);if(blockers.length)throw new QcError(blockers[0]!,409);
      const conversation=await load(job,principal,c),fingerprint=sourceFingerprint(conversation);
      const validate=async()=>{
        const current=await config(job.department_id);assertDepartmentScanEnabled(current,false,job.config_version);
        const who=await resolve(c.updated_by);for(const action of ['create','edit','approve','view_all'] as const)demand(who.actor,action);
        if(!['owner','admin'].includes(who.user.role)||createHash('sha256').update(who.user.passwordHash).digest('hex')!==c.principal_epoch)throw new QcError('CONTINUOUS_PRINCIPAL_REVOKED',403);
        const lease=await prisma.$queryRaw<Array<{ok:boolean}>>(Prisma.sql`SELECT TRUE AS ok FROM ai_qc_continuous_job WHERE id=${job.id} AND org_id=${orgId} AND generation=${job.generation} AND state='PROCESSING' AND lease_until>NOW()`);
        if(!lease[0]?.ok)throw new QcError('CONTINUOUS_LEASE_LOST',409);
        if(sourceFingerprint(await load(job,who,current))!==fingerprint)throw new QcError('CONTINUOUS_SOURCE_CHANGED',409);
      };
      const scoped:WorkspaceRepository={read:async id=>{const s=await repo.read(id);return {...s,documents:s.documents.filter(d=>d.orgId===orgId&&!d.synthetic&&d.rule&&c.analysis_types.includes(d.rule.type)&&(!d.departmentIds.length||d.departmentIds.includes(c.department_id)))};},mutate:(id,fn)=>repo.mutate(id,fn)};
      const analyzer=new ConversationAnalyzerService(scoped,new AIProviderService(environment),environment);
      const permit=issueContinuousAuthority(principal.actor,conversation,{jobId:job.id,messageId:job.message_id,departmentId:c.department_id,recipientUserIds:c.recipient_user_ids,validate});
      const run=await analyzer.analyze(principal.actor,conversation,'ollama',undefined,permit);
      await validate();
      await prisma.$executeRaw(Prisma.sql`UPDATE ai_qc_continuous_job SET state='DONE',run_id=${run.id},error_code=${run.missingContext[0]??null},lease_until=NULL,updated_at=NOW() WHERE org_id=${orgId} AND id=${job.id} AND generation=${job.generation} AND state='PROCESSING'`);
    }catch(error){const code=error instanceof QcError?error.code:'CONTINUOUS_SERVICE_UNAVAILABLE';const retry=continuousRetry(code,job.attempts);
      await prisma.$executeRaw(Prisma.sql`UPDATE ai_qc_continuous_job SET state=${retry.terminal?(job.attempts>=5?'DEAD':'SKIPPED'):'RETRY'},error_code=${code},due_at=NOW()+${retry.delay}*INTERVAL '1 millisecond',lease_until=NULL,updated_at=NOW() WHERE org_id=${orgId} AND id=${job.id} AND generation=${job.generation} AND state='PROCESSING'`);
    }
  };
  let busy=false,closing=false;
  const tick=async()=>{if(busy||closing)return;busy=true;try{await discover();const job=await claim();if(job)await processJob(job);await notify();
    await prisma.$executeRaw(Prisma.sql`UPDATE ai_qc_continuous_job SET state='DEAD',error_code='LEASE_ATTEMPTS_EXHAUSTED',updated_at=NOW() WHERE org_id=${orgId} AND state='PROCESSING' AND lease_until<NOW() AND attempts>=5`);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM ai_qc_continuous_job WHERE org_id=${orgId} AND state IN ('DONE','DEAD','SKIPPED') AND created_at<NOW()-INTERVAL '7 days'`);
  }catch{app.log.warn('AIQC_CONTINUOUS_TICK_UNAVAILABLE');}finally{busy=false;}};
  const timer=setInterval(()=>void tick(),2000);timer.unref();
  app.addHook('onClose',async()=>{closing=true;clearInterval(timer);namespace.disconnectSockets(true);namespace.removeAllListeners();});
}
