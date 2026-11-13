import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
import {initialWorkspace,type Actor} from '../src/modules/ai-quality-control/contracts.js';
const db=vi.hoisted(()=>({department:{findFirst:vi.fn()},user:{count:vi.fn()},$queryRaw:vi.fn(),$executeRaw:vi.fn(),$transaction:vi.fn()}));
vi.mock('../src/shared/database/prisma-client.js',()=>({prisma:db}));
import {registerDepartmentMonitoringConfigRoutes} from '../src/modules/ai-quality-control/department-monitoring-config.js';
import {assertDepartmentScanEnabled,departmentEnableBlockers} from '../src/modules/ai-quality-control/department-monitoring-validation.js';
const actor:Actor={id:'admin-a',orgId:'org-a',departmentIds:[],permissions:['access','create','edit','approve','view_all']};
let config:any,paused:boolean,runtime:boolean,role:string,permissions:Actor['permissions'],app:ReturnType<typeof Fastify>,workspace:ReturnType<typeof initialWorkspace>;
const audits:string[]=[];
beforeEach(async()=>{
  vi.clearAllMocks();audits.length=0;paused=false;runtime=true;role='admin';permissions=[...actor.permissions];
  config={enabled:false,version:'1',analysis_types:['INSULT'],recipient_user_ids:['reviewer-a'],approval_ref:'policy-1',lookback_hours:24,max_conversations_per_run:5};
  workspace=initialWorkspace();workspace.settings.retentionDays=7;workspace.settings.retentionApprovedBy='admin-a';
  workspace.documents.push({id:'doc-a',documentId:'doc-a',orgId:'org-a',sourcePath:'policy.md',revision:1,contentHash:'a'.repeat(64),markdown:'policy',category:'policy',synthetic:false,stagedBy:'admin-a',status:'APPROVED',approvedBy:'admin-a',approvedAt:new Date().toISOString(),effectiveFrom:new Date(Date.now()-3600000).toISOString(),effectiveTo:null,departmentIds:['dept-a'],rule:{id:'rule',type:'INSULT',matchTerms:[],conflictGroup:null,slaSeconds:null,careIntervalDays:null}});
  db.department.findFirst.mockImplementation(async({where}:any)=>where.id==='dept-a'&&where.orgId==='org-a'?{id:'dept-a'}:null);
  db.user.count.mockResolvedValue(1);
  db.$queryRaw.mockImplementation(async(sql:any)=>sql.sql.includes('SELECT paused')?[{paused}]:[{...config}]);
  db.$executeRaw.mockImplementation(async(sql:any)=>{
    const v=sql.values;
    if(sql.sql.includes('INSERT INTO ai_qc_department_monitor_audit')){audits.push(v[4]);return 1;}
    if(sql.sql.includes('UPDATE ai_qc_department_monitor_config SET enabled=')){
      if(sql.sql.includes('WHERE org_id=')&&sql.sql.includes('AND version=')){if(v[v.length-3]!=='org-a'||v[v.length-2]!=='dept-a'||v[v.length-1]!==config.version)return 0;config.enabled=v[0];}
      else config.enabled=false;
      config.version=String(Number(config.version)+1);return 1;
    }
    if(sql.sql.includes('INSERT INTO ai_qc_department_monitor_control'))paused=v[1];
    return 1;
  });
  db.$transaction.mockImplementation(async(fn:any)=>fn(db));
  app=Fastify();app.addHook('preHandler',async request=>{(request as any).user={id:actor.id,orgId:actor.orgId,role};});
  await registerDepartmentMonitoringConfigRoutes(app,{actor:async()=>({...actor,permissions}),runtimeAvailable:()=>runtime,moduleAvailable:()=>true,repo:{read:async()=>structuredClone(workspace),mutate:async()=>{throw Error('not used');}}});
});
afterEach(async()=>{await app.close();});
const toggle=(enabled:boolean,version=config.version)=>app.inject({method:'PUT',url:'/api/v1/ai-quality-control/department-monitoring/departments/dept-a/enabled',payload:{enabled,version}});
describe('department AI toggle API',()=>{
  it('persists on/off and audits both transitions; disabling remains available if runtime is unavailable',async()=>{
    expect((await toggle(true)).statusCode).toBe(200);expect(config.enabled).toBe(true);runtime=false;
    expect((await toggle(false)).statusCode).toBe(200);expect(config.enabled).toBe(false);expect(audits).toEqual(['AI_ENABLED','AI_DISABLED']);
  });
  it('denies cross-tenant department IDs without changing config',async()=>{
    const r=await app.inject({method:'PUT',url:'/api/v1/ai-quality-control/department-monitoring/departments/dept-b/enabled',payload:{enabled:true,version:'1'}});
    expect(r.statusCode).toBe(404);expect(db.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects missing grants and non-admin users',async()=>{
    permissions=['access'];expect((await toggle(true)).statusCode).toBe(403);permissions=[...actor.permissions];role='member';expect((await toggle(true)).statusCode).toBe(403);expect(config.enabled).toBe(false);
  });
  it('rejects stale versions, stopped tenants and runtime gates',async()=>{
    expect((await toggle(true,'2')).statusCode).toBe(409);paused=true;expect((await toggle(true)).statusCode).toBe(423);paused=false;runtime=false;expect((await toggle(true)).statusCode).toBe(409);expect(config.enabled).toBe(false);
  });
  it('requires real, current, correctly scoped policy and approved retention',async()=>{
    workspace.documents[0]!.synthetic=true;expect((await toggle(true)).statusCode).toBe(409);
    workspace.documents[0]!.synthetic=false;workspace.documents[0]!.departmentIds=['other'];expect((await toggle(true)).statusCode).toBe(409);
    workspace.documents[0]!.departmentIds=['dept-a'];workspace.documents[0]!.effectiveFrom=new Date(Date.now()+3600000).toISOString();expect((await toggle(true)).statusCode).toBe(409);
    workspace.documents[0]!.effectiveFrom=new Date(Date.now()-3600000).toISOString();workspace.documents[0]!.effectiveTo=new Date(Date.now()-1000).toISOString();expect((await toggle(true)).statusCode).toBe(409);
    workspace.documents[0]!.effectiveTo=null;workspace.settings.retentionApprovedBy=null;expect((await toggle(true)).statusCode).toBe(409);expect(config.enabled).toBe(false);
  });
  it('emergency stop switches off departments; resume does not turn them back on',async()=>{
    await toggle(true);const r=await app.inject({method:'POST',url:'/api/v1/ai-quality-control/department-monitoring/kill-switch',payload:{reason:'test stop'}});expect(r.statusCode).toBe(200);expect(paused).toBe(true);expect(config.enabled).toBe(false);
    const cleared=await app.inject({method:'POST',url:'/api/v1/ai-quality-control/department-monitoring/resume',payload:{reason:'test resume'}});expect(cleared.statusCode).toBe(200);expect(paused).toBe(false);expect(config.enabled).toBe(false);
  });
  it('invalidates previews across off/on transitions and rejects paused scans',()=>{
    expect(()=>assertDepartmentScanEnabled(config,false)).toThrow('DEPARTMENT_AI_DISABLED');config.enabled=true;expect(()=>assertDepartmentScanEnabled(config,true)).toThrow('KILL_SWITCH');expect(()=>assertDepartmentScanEnabled(config,false,'2')).toThrow('CONFIGURATION_CHANGED');expect(()=>assertDepartmentScanEnabled(config,false,'1')).not.toThrow();
    workspace.documents[0]!.orgId='org-b';expect(departmentEnableBlockers(config,workspace,'org-a','dept-a',true)).toContain('APPROVED_DEPARTMENT_RULES_MISSING:INSULT');
  });
});
