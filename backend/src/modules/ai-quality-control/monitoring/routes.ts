import type {FastifyInstance,FastifyRequest,preHandlerHookHandler} from 'fastify';
import {demand,QcError,type WorkspaceRepository} from '../contracts.js';
import {redactPII} from '../analysis.js';
import {visibleWarning} from './notification-outbox.js';
import {monitoringHealth} from './health.js';
import {purgeMonitoring} from './retention.js';
import type {MonitoringRepository,MonitoringSettings,ResolveActor} from './contracts.js';
export async function monitoringRoutes(app:FastifyInstance,deps:{store:MonitoringRepository;workspace:WorkspaceRepository;settings:MonitoringSettings;authenticate:preHandlerHookHandler;resolve:ResolveActor;heartbeat:()=>number|null}){
 const wrap=(fn:(request:FastifyRequest)=>Promise<unknown>)=>async(request:FastifyRequest,reply:any)=>{try{if(!deps.settings.enabled)throw new QcError('MONITORING_DISABLED',503);return await fn(request);}catch(error){return reply.code(error instanceof QcError?error.statusCode:503).send({error:error instanceof QcError?error.code:'MONITORING_UNAVAILABLE'});}};
 const actor=async(request:FastifyRequest)=>{const a=await deps.resolve(request.user.id,request.user.orgId);demand(a,'access');return a;};
 const prefix='/api/v1/ai-quality-control/monitoring';
 app.addHook('preHandler',deps.authenticate);
 app.get(prefix+'/warnings',wrap(async request=>{const a=await actor(request),state=await deps.store.read(a.orgId),warnings=[];for(const w of state.warnings)if(await visibleWarning(a,w,deps.workspace))warnings.push(w);return {enabled:true,syntheticOnly:true,warnings:warnings.map(({evidence,...rest})=>rest),open:warnings.filter(w=>w.status==='OPEN').length};}));
 app.get(prefix+'/warnings/:id',wrap(async request=>{const a=await actor(request),w=(await deps.store.read(a.orgId)).warnings.find(v=>v.id===(request.params as {id:string}).id);if(!w||!await visibleWarning(a,w,deps.workspace))throw new QcError('WARNING_NOT_FOUND',404);return w;}));
 app.post(prefix+'/warnings/:id/review',wrap(async request=>{const a=await actor(request);demand(a,'approve');const input=request.body as {status?:string;version?:number;reason?:string}|undefined;
  if(!input||!['OPEN','ACKNOWLEDGED','DISMISSED'].includes(input.status??'')||!Number.isInteger(input.version)||typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000)throw new QcError('INVALID_WARNING_REVIEW');
  const id=(request.params as {id:string}).id,w=(await deps.store.read(a.orgId)).warnings.find(v=>v.id===id);if(!w||!await visibleWarning(a,w,deps.workspace))throw new QcError('WARNING_NOT_FOUND',404);
  return deps.store.mutate(a.orgId,s=>{const current=s.warnings.find(v=>v.id===id);if(!current||current.evidenceHash!==w.evidenceHash||current.version!==input.version)throw new QcError('WARNING_REVIEW_CONFLICT',409);
   current.status=input.status as typeof current.status;current.version++;current.updatedAt=Date.now();current.reviews.push({actorId:a.id,at:current.updatedAt,status:current.status,reason:redactPII(input.reason!)});
   s.deliveries.push({id:'delivery-'+id+'-v'+current.version,orgId:a.orgId,warningId:id,createdAt:current.updatedAt,delivered:false});return current;
  });
 }));
 app.post(prefix+'/retention/purge',wrap(async request=>{const a=await actor(request);return purgeMonitoring(deps.store,deps.workspace,a,(request.body as {reason?:unknown}|undefined)?.reason);}));
 app.get(prefix+'/health',wrap(async request=>{const a=await actor(request);demand(a,'edit');demand(a,'view_all');return monitoringHealth(deps.store,a.orgId,true,deps.heartbeat());}));
}
