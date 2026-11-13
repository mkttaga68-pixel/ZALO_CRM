import path from 'node:path';
import {Pool} from 'pg';
import type {FastifyInstance} from 'fastify';
import type {Server} from 'socket.io';
import {prisma} from '../../../shared/database/prisma-client.js';
import {assertActiveSession} from '../../auth/active-session.js';
import {authMiddleware} from '../../auth/auth-middleware.js';
import {userHasGrant} from '../../rbac/permission-group-service.js';
import {automationEventBus} from '../../automation/engine/event-bus.js';
import {QcError,type Action,type WorkspaceRepository} from '../contracts.js';
import {runtimeMonitoringSettings} from './settings.js';
import {PostgresMonitoringRepository} from './repository.js';
import {MonitoringQueue} from './queue.js';
import {MonitoringWorker} from './worker.js';
import {SyntheticMessageAdapter} from './synthetic-message-adapter.js';
import {MonitoringSlaScheduler} from './sla-scheduler.js';
import {MonitoringNotifications} from './notification-outbox.js';
import {monitoringRoutes} from './routes.js';
/** The ONLY runtime composition point, called exclusively by the sandbox opt-in. */
export async function registerMonitoringSandbox(app:FastifyInstance,workspace:WorkspaceRepository){
 const settings=runtimeMonitoringSettings();if(!settings.enabled)return;
 const proof=(globalThis as Record<symbol,unknown>)[Symbol.for('zlcrm.synthetic-qc-runtime')] as {root:string;dbPort:number};
 const raw=process.env.AI_QC_SANDBOX_DATABASE_URL;if(!raw)throw new QcError('MONITORING_DATABASE_REQUIRED',503);
 const target=new URL(raw);if(target.hostname!=='127.0.0.1'||Number(target.port)!==proof.dbPort||!/^\/ai_qc_sandbox_knowledge_[a-z0-9_]+$/.test(target.pathname))throw new QcError('MONITORING_DATABASE_INVALID',503);
 const pool=new Pool({connectionString:raw,max:3,connectionTimeoutMillis:3000});
 try{const result=await pool.query("SELECT current_database() AS name,current_setting('data_directory') AS directory,to_regclass('public.native_ai_qc_monitoring_job') AS job,to_regclass('public.native_ai_qc_monitoring_warning') AS warning,to_regclass('public.native_ai_qc_monitoring_delivery') AS delivery");const row=result.rows[0];
  if(row.name!==target.pathname.slice(1)||path.resolve(row.directory).toLowerCase()!==path.join(proof.root,'postgres-data').toLowerCase())throw new QcError('MONITORING_CLUSTER_IDENTITY_MISMATCH',503);
  if(!row.job||!row.warning||!row.delivery)throw new QcError('MONITORING_SCHEMA_NOT_READY',503);
 }catch(error){await pool.end();throw error;}
 const resolve=async(id:string,orgId:string)=>{const user=await prisma.user.findFirst({where:{id,orgId,isActive:true},select:{id:true,orgId:true}});if(!user)throw new QcError('MONITORING_ACTOR_REVOKED',403);
  const permissions:Action[]=[];for(const action of ['access','create','edit','approve','delete','view_all'] as const)if(await userHasGrant(id,'ai_quality_control',action))permissions.push(action);
  const members=await prisma.departmentMember.findMany({where:{userId:id,department:{orgId}},select:{departmentId:true}});return {...user,permissions,departmentIds:members.map(m=>m.departmentId)};
 };
 const store=new PostgresMonitoringRepository(pool),queue=new MonitoringQueue(store,settings),worker=new MonitoringWorker(queue,workspace,resolve),adapter=new SyntheticMessageAdapter(store,settings),scheduler=new MonitoringSlaScheduler(adapter,workspace);
 const io=(app as FastifyInstance&{io:Server}).io;
 const notifications=new MonitoringNotifications(io,store,workspace,async socket=>{const token=socket.handshake.auth?.token;if(typeof token!=='string')throw new QcError('UNAUTHORIZED',401);const claims=app.jwt.verify<{id:string;orgId:string;role:string;credentialVersion:string}>(token);await assertActiveSession(claims);return resolve(claims.id,claims.orgId);});
 const tenants=new Set<string>();
 const unsubscribe=automationEventBus.onType(['message_received'],event=>{if((event.payload as {syntheticMonitoring?:boolean})?.syntheticMonitoring)tenants.add(event.orgId);});
 let busy=false;const timer=setInterval(()=>{if(busy)return;busy=true;void(async()=>{for(const row of (await pool.query('SELECT DISTINCT organization_id FROM native_ai_qc_monitoring_job')).rows)tenants.add(row.organization_id);for(const orgId of tenants){await worker.tick(orgId);await notifications.flush(orgId);}})().catch(()=>{app.log.warn('Synthetic monitoring tick failed');}).finally(()=>{busy=false;});},settings.pollMs);timer.unref();
 // Existing persisted jobs are rediscovered after restart, not dependent on the volatile bus.
 for(const row of (await pool.query('SELECT DISTINCT organization_id FROM native_ai_qc_monitoring_job')).rows)tenants.add(row.organization_id);
 const slaTimer=setInterval(()=>{void(async()=>{for(const orgId of tenants){const state=await store.read(orgId);const latest=new Map<string,typeof state.jobs[number]>();for(const job of state.jobs.filter(j=>j.kind==='MESSAGE').sort((a,b)=>a.createdAt-b.createdAt))latest.set(job.conversation.id,job);for(const job of latest.values())try{await scheduler.evaluate(await resolve(job.actor.id,orgId),job.conversation);}catch{app.log.warn('Synthetic SLA fixture skipped after authorization failure');}}})().catch(()=>app.log.warn('Synthetic SLA tick failed'));},60000);slaTimer.unref();
 await app.register(async child=>monitoringRoutes(child,{store,workspace,settings,authenticate:authMiddleware,resolve,heartbeat:()=>worker.heartbeat}));
 // Synthetic fixture injection is deliberately an in-process adapter, never a production route.
 app.decorate('syntheticMonitoring', {adapter,worker,scheduler,store});
 app.addHook('onClose',async()=>{clearInterval(timer);clearInterval(slaTimer);unsubscribe();notifications.close();await pool.end();});
}
