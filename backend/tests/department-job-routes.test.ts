import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {initialWorkspace,type Actor,QcError} from '../src/modules/ai-quality-control/contracts.js';
const mocks=vi.hoisted(()=>({query:vi.fn(),execute:vi.fn(),department:vi.fn(),authorize:vi.fn(),config:vi.fn(),paused:vi.fn(),admission:vi.fn()}));
vi.mock('../src/shared/database/prisma-client.js',()=>({prisma:{$queryRaw:mocks.query,department:{findFirst:mocks.department},$transaction:async(fn:any)=>fn({$executeRaw:mocks.execute})}}));
vi.mock('../src/modules/ai-quality-control/department-monitoring-config.js',()=>({readDepartmentScanConfig:mocks.config,departmentScanPaused:mocks.paused}));
vi.mock('../src/modules/ai-quality-control/ollama-provider.js',()=>({ollamaAdmission:mocks.admission}));
import {registerDepartmentJobRoutes} from '../src/modules/ai-quality-control/department-job-routes.js';
let app:ReturnType<typeof Fastify>,actor:Actor,role:string,enabled:boolean,state:ReturnType<typeof initialWorkspace>;
const at=new Date('2026-11-13T01:00:00Z');
const job=(id='job-a',code='OLLAMA_RESOURCE_LIMIT')=>({id,conversation_id:'chat-'+id,state:'DEAD',error_code:code,attempts:5,created_at:at,updated_at:at,config_version:'1'});
const url='/api/v1/ai-quality-control/department-monitoring/departments/dept-a/jobs';
beforeEach(async()=>{
  vi.resetAllMocks();role='admin';enabled=true;
  actor={id:'admin-a',orgId:'org-a',permissions:['access','edit','approve','view_all','create'],departmentIds:[]};
  state=initialWorkspace();state.settings.dailyTokenBudget=20000;
  state.reservations=[{id:'r',actorId:'admin-a',at:new Date().toISOString(),tokens:16363}];
  mocks.department.mockResolvedValue({id:'dept-a'});mocks.query.mockResolvedValue([job()]);mocks.authorize.mockResolvedValue({});
  mocks.config.mockResolvedValue({enabled:true,version:'1'});mocks.paused.mockResolvedValue(false);mocks.admission.mockResolvedValue({ok:true});mocks.execute.mockResolvedValue(1);
  app=Fastify();app.addHook('preHandler',async request=>{(request as any).user={role};});
  await registerDepartmentJobRoutes(app,{actor:async()=>actor,enabled:()=>enabled,authorizeConversation:mocks.authorize,repo:{read:async()=>state,mutate:async()=>{throw Error('unused');}}});
});
afterEach(async()=>{await app.close();});
const retry=()=>app.inject({method:'POST',url:url+'/job-a/retry',payload:{expectedUpdatedAt:at.toISOString()}});
describe('department job warnings and explicit recovery',()=>{
  it('reports each real cause and budget without exposing conversation/message contents',async()=>{
    mocks.query.mockResolvedValue([job(),job('job-b','AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED')]);
    const r=await app.inject(url);expect(r.statusCode).toBe(200);const body=r.json();expect(body.items.map((i:any)=>i.errorCode)).toEqual(['OLLAMA_RESOURCE_LIMIT','AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED']);
    expect(body.budget).toEqual({daily:20000,reserved:16363,remaining:3637});expect(body.items[0].conversation_id).toBeUndefined();expect(body.items[0].canRetry).toBe(true);
    const query=mocks.query.mock.calls[0][0];expect(query.sql).toContain('org_id=');expect(query.values).toContain('org-a');expect(query.values).toContain('dept-a');expect(query.sql).toContain('LIMIT 21');
  });
  it('filters inaccessible conversations, bounds paging, and rejects invalid offsets',async()=>{
    mocks.query.mockResolvedValue(Array.from({length:21},(_,i)=>job('job-'+i)));mocks.authorize.mockRejectedValue(new QcError('CONVERSATION_NOT_FOUND',404));
    const body=(await app.inject(url)).json();expect(body.items).toEqual([]);expect(body.nextOffset).toBe(20);expect(mocks.authorize).toHaveBeenCalledTimes(20);
    expect((await app.inject(url+'?offset=-1')).statusCode).toBe(400);
  });
  it('requires active admin grants and a department in the same tenant',async()=>{
    actor.permissions=['access'];expect((await app.inject(url)).statusCode).toBe(403);
    actor.permissions=['access','edit','approve','view_all'];role='member';expect((await app.inject(url)).statusCode).toBe(403);
    role='admin';mocks.department.mockResolvedValue(null);expect((await app.inject(url)).statusCode).toBe(404);expect(mocks.query).not.toHaveBeenCalled();
  });
  it('does not requeue automatically when listing and rejects disabled API',async()=>{
    await app.inject(url);expect(mocks.execute).not.toHaveBeenCalled();enabled=false;expect((await retry()).statusCode).toBe(503);
  });
  it('requeues just the selected failed job with audit and current configuration checks',async()=>{
    expect((await retry()).statusCode).toBe(200);expect(mocks.authorize).toHaveBeenCalledWith(actor,'chat-job-a',expect.anything());
    expect(mocks.execute).toHaveBeenCalledTimes(3);const update=mocks.execute.mock.calls[1][0];expect(update.sql).toContain("j.state='DEAD'");expect(update.sql).toContain('c.version=j.config_version');expect(update.sql).toContain('ctl.paused');expect(update.values).toContain('job-a');expect(mocks.execute.mock.calls[2][0].sql).toContain('JOB_RETRY_REQUESTED');
  });
  it('refuses stale jobs, permanent errors and revoked conversation access',async()=>{
    mocks.query.mockResolvedValue([{...job(),state:'RETRY'}]);expect((await retry()).statusCode).toBe(409);
    mocks.query.mockResolvedValue([job('job-a','CONTINUOUS_PRINCIPAL_REVOKED')]);expect((await retry()).statusCode).toBe(409);
    mocks.query.mockResolvedValue([job()]);mocks.authorize.mockRejectedValue(new QcError('CONVERSATION_NOT_FOUND',404));expect((await retry()).statusCode).toBe(404);expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('keeps resource, paused/config-version and budget guards in place',async()=>{
    mocks.paused.mockResolvedValue(true);expect((await retry()).statusCode).toBe(423);mocks.paused.mockResolvedValue(false);
    mocks.config.mockResolvedValue({enabled:true,version:'2'});expect((await retry()).statusCode).toBe(409);mocks.config.mockResolvedValue({enabled:true,version:'1'});
    mocks.admission.mockResolvedValue({ok:false,code:'OLLAMA_RESOURCE_LIMIT'});expect((await retry()).statusCode).toBe(503);mocks.admission.mockResolvedValue({ok:true});
    state.settings.dailyTokenBudget=16363;expect((await retry()).statusCode).toBe(429);expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('rejects concurrent retries atomically',async()=>{
    mocks.execute.mockImplementation(async sql=>sql.sql.includes('UPDATE ai_qc_continuous_job')?0:1);expect((await retry()).statusCode).toBe(409);expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
});
