import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {initialWorkspace,type Actor,type Conversation} from '../src/modules/ai-quality-control/contracts.js';
import {MemoryWorkspaceRepository} from '../src/modules/ai-quality-control/repository.js';
import {digest} from '../src/modules/ai-quality-control/knowledge.js';
const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),user:vi.fn(),membership:vi.fn(),message:vi.fn(),grant:vi.fn(),admission:vi.fn(),provider:vi.fn()}));
vi.mock('../src/shared/database/prisma-client.js',()=>({prisma:{$queryRaw:mocks.query,$executeRaw:mocks.execute,user:{findFirst:mocks.user},departmentMember:{findFirst:mocks.membership,findMany:async()=>[{userId:'staff-a'}]},message:{findFirst:mocks.message}}}));
vi.mock('../src/modules/rbac/permission-group-service.js',()=>({userHasGrant:mocks.grant}));
vi.mock('../src/modules/auth/active-session.js',()=>({assertActiveSession:async()=>{}}));
vi.mock('../src/modules/ai-quality-control/ollama-provider.js',()=>({ollamaAdmission:mocks.admission,OllamaProvider:class{analyze(input:unknown){return mocks.provider(input);}}}));
import {MockAIProvider} from '../src/modules/ai-quality-control/providers.js';
import {registerContinuousLocal,continuousRetry} from '../src/modules/ai-quality-control/continuous-runtime.js';
import {issueContinuousAuthority,consumeContinuousAuthority} from '../src/modules/ai-quality-control/continuous-authorization.js';
import {createHash} from 'node:crypto';
const actor:Actor={id:'admin-a',orgId:'org-a',departmentIds:['dept-a'],permissions:['access','create','edit','approve','view_all']};
const now=Date.now();
let repo:MemoryWorkspaceRepository,job:any,config:any,paused:boolean,hasMessage:boolean,closed:(()=>Promise<void>)|undefined,emit:ReturnType<typeof vi.fn>,conversation:Conversation,namespace:any;
beforeEach(async()=>{
 vi.useFakeTimers();vi.setSystemTime(now);vi.clearAllMocks();
 vi.stubEnv('AI_QC_CONTINUOUS_LOCAL_ENABLED','true');vi.stubEnv('AI_QC_DEPLOYMENT_TIER','local-test');
 paused=false;hasMessage=true;job=null;closed=undefined;
 config={org_id:'org-a',department_id:'dept-a',enabled:true,continuous_enabled:true,version:'1',analysis_types:['COURTESY'],recipient_user_ids:['reviewer-a'],lookback_hours:24,max_conversations_per_run:100,approval_ref:'test-only',updated_by:'admin-a',principal_epoch:createHash('sha256').update('test-password-hash').digest('hex')};
 conversation={id:'chat-a',orgId:'org-a',source:'CRM',departmentIds:['dept-a'],coverage:'UNKNOWN',assignedActorId:null,assignmentStatus:'UNKNOWN',workIntervals:null,offDayIntervals:null,provenanceHash:null,observationEndAt:new Date(now).toISOString(),messages:[{id:'question',role:'CUSTOMER',actorId:null,attribution:'UNKNOWN',timestampStatus:'VERIFIED',text:'Nhờ bạn giúp?',occurredAt:new Date(now-20000).toISOString()},{id:'message-a',role:'HUMAN',actorId:'staff-a',attribution:'VERIFIED',timestampStatus:'VERIFIED',text:'tự đi mà tìm',occurredAt:new Date(now-10000).toISOString()}]};
 mocks.user.mockImplementation(async({where}:any)=>({id:where.id,orgId:'org-a',role:'admin',email:'fake@example.invalid',passwordHash:'test-password-hash'}));mocks.membership.mockResolvedValue({joinedAt:new Date(now-3600000)});mocks.message.mockResolvedValue({sentAt:new Date(now-10000),createdAt:new Date(now-10000)});mocks.grant.mockResolvedValue(true);mocks.admission.mockResolvedValue({ok:true,freeRamBytes:4*1024**3});mocks.provider.mockImplementation(input=>new MockAIProvider().analyze(input));
 mocks.query.mockImplementation(async(sql:any)=>{
  const q=sql.sql;
  if(q.includes('to_regclass'))return [{ready:true}];
  if(q.includes('SELECT paused'))return [{paused}];
  if(q.includes('SELECT c.*'))return [{...config}];
  if(q.includes('RETURNING id,org_id')){if(!job||!['PENDING','RETRY'].includes(job.state)||job.due> Date.now())return [];job.state='PROCESSING';job.attempts++;job.generation++;return [{...job}];}
  if(q.includes('SELECT TRUE AS ok'))return job?.state==='PROCESSING'?[{ok:true}]:[];
  if(q.includes('SELECT id,run_id'))return job?.state==='DONE'&&!job.notified?[{...job}]:[];
  if(q.includes('SELECT c.recipient_user_ids'))return [{recipient_user_ids:config.recipient_user_ids}];
  throw Error('Unexpected query '+q);
 });
 mocks.execute.mockImplementation(async(sql:any)=>{
  const q=sql.sql,v=sql.values;
  if(q.includes('INSERT INTO ai_qc_continuous_job')){if(hasMessage&&config.enabled&&config.continuous_enabled&&!job)job={id:'job-a',org_id:'org-a',department_id:'dept-a',config_version:'1',message_id:'message-a',conversation_id:'chat-a',employee_id:'staff-a',attempts:0,generation:0,state:'PENDING',due:0};}
  else if(q.includes("SET state='DONE'")){job.state='DONE';job.run_id=v[0];}
  else if(q.includes('SET state=')&&!q.includes("SET state='DEAD'")){job.state=v[0];job.error=v[1];job.due=Date.now()+v[2];}
  else if(q.includes('SET notified=TRUE'))job.notified=true;
  return 1;
 });
 repo=new MemoryWorkspaceRepository();const markdown='[SYNTHETIC TEST ONLY] Không nói tự đi mà tìm với khách.';
 await repo.mutate('org-a',s=>{s.settings={...initialWorkspace().settings,retentionDays:7,retentionApprovedBy:'admin-a'};s.documents.push({id:'policy',documentId:'policy',orgId:'org-a',sourcePath:'TEST-ONLY.md',revision:1,contentHash:digest(markdown),markdown,category:'test',synthetic:false,stagedBy:'admin-a',status:'APPROVED',approvedBy:'admin-a',approvedAt:new Date(now-3600000).toISOString(),effectiveFrom:new Date(now-3600000).toISOString(),effectiveTo:null,departmentIds:['dept-a'],rule:{id:'rule',type:'COURTESY',matchTerms:['tự đi mà tìm'],conflictGroup:null,slaSeconds:null,careIntervalDays:null}});});
 emit=vi.fn();namespace={sockets:new Map([['socket',{handshake:{auth:{token:'synthetic-token'}},emit,disconnect:vi.fn()}]]),use:vi.fn(),on:vi.fn(),disconnectSockets:vi.fn(),removeAllListeners:vi.fn()};
});
afterEach(async()=>{await closed?.();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllEnvs();});
async function start(){await registerContinuousLocal({io:{of:()=>namespace},jwt:{verify:()=>({id:'reviewer-a',orgId:'org-a',role:'admin',credentialVersion:'fake'})},addHook:(_name:string,fn:any)=>{closed=fn;},log:{warn:vi.fn()}} as any,repo,{enabled:true,realData:true,realDataOrgId:'org-a',ollamaEnabled:true,ollamaRealData:true,openAiRemoved:true,manualRetention:true,realApi:false,outboundTestApproved:false,realDataOutboundApproved:false,apiKey:()=>undefined,capabilities:{}},{loadAt:async()=>structuredClone(conversation),load:async()=>structuredClone(conversation)} as any);}
describe('continuous local worker with synthetic database/provider adapters',()=>{
 it('discovers new staff messages, creates one evidence run and sends a payload-free realtime hint',async()=>{await start();await vi.advanceTimersByTimeAsync(2000);expect(job.state).toBe('DONE');expect(mocks.provider).toHaveBeenCalledTimes(1);const state=await repo.read('org-a');expect(state.runs).toHaveLength(1);expect(state.runs[0]!.departmentObservation?.recipientUserIds).toEqual(['reviewer-a']);expect(emit).toHaveBeenCalledWith('aiqc:observations-changed',{});await vi.advanceTimersByTimeAsync(4000);expect((await repo.read('org-a')).runs).toHaveLength(1);expect(mocks.provider).toHaveBeenCalledTimes(1);});
 it('never calls the model while paused',async()=>{paused=true;await start();await vi.advanceTimersByTimeAsync(4000);expect(job).toBeNull();expect(mocks.provider).not.toHaveBeenCalled();});
 it('retries resource admission failure without inventing a run or warning',async()=>{mocks.admission.mockResolvedValue({ok:false,code:'OLLAMA_RESOURCE_LIMIT'});await start();await vi.advanceTimersByTimeAsync(2000);expect(job.state).toBe('RETRY');expect(job.error).toBe('OLLAMA_RESOURCE_LIMIT');expect((await repo.read('org-a')).runs).toHaveLength(0);expect(emit).not.toHaveBeenCalled();});
 it('skips revoked authority before sending any content',async()=>{mocks.grant.mockResolvedValue(false);await start();await vi.advanceTimersByTimeAsync(2000);expect(job.state).toBe('SKIPPED');expect(mocks.provider).not.toHaveBeenCalled();});
 it('checks department state again when model admission is reached',async()=>{mocks.admission.mockImplementation(async()=>{config.enabled=false;return {ok:true};});await start();await vi.advanceTimersByTimeAsync(2000);expect(mocks.provider).not.toHaveBeenCalled();expect(job.state).toBe('SKIPPED');});
 it('does not notify a removed recipient',async()=>{mocks.provider.mockImplementation(async input=>{const output=await new MockAIProvider().analyze(input);config.recipient_user_ids=[];return output;});await start();await vi.advanceTimersByTimeAsync(2000);expect(job.state).toBe('DONE');expect(emit).not.toHaveBeenCalled();});
 it('rejects forged/reused capabilities and refuses endpoint/retention/tenant drift',async()=>{
   await expect(consumeContinuousAuthority({},actor,conversation)).rejects.toThrow('CONTINUOUS_AUTHORITY_INVALID');
   const permit=issueContinuousAuthority(actor,conversation,{jobId:'test',messageId:'message-a',departmentId:'dept-a',recipientUserIds:[],validate:async()=>{}});await consumeContinuousAuthority(permit,actor,conversation);await expect(consumeContinuousAuthority(permit,actor,conversation)).rejects.toThrow('CONTINUOUS_AUTHORITY_INVALID');
   expect(continuousRetry('OLLAMA_RESOURCE_LIMIT',5).terminal).toBe(true);expect(continuousRetry('CONTINUOUS_PRINCIPAL_REVOKED',1).terminal).toBe(true);
 });
});
