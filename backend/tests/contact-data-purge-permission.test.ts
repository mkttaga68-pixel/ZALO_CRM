import {beforeEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
const state=vi.hoisted(()=>({
  role:'admin',granted:false,active:true,archived:false,
  findUser:vi.fn(),targets:vi.fn(),preview:vi.fn(),execute:vi.fn(),resume:vi.fn(),
}));
vi.mock('../src/shared/database/prisma-client.js',()=>({prisma:{user:{findUnique:state.findUser}}}));
vi.mock('../src/modules/auth/auth-middleware.js',()=>({authMiddleware:async(req:any,reply:any)=>{
  if(!req.headers.authorization){reply.code(401).send({error:'Unauthorized'});return;}
  req.user={id:'actor',orgId:'org-test',email:'actor@example.invalid',role:state.role};
}}));
vi.mock('../src/modules/contacts/admin-purge-service.js',()=>({listPurgeTargets:state.targets,buildPurgePlan:state.preview,executePurge:state.execute,resumeSync:state.resume}));
import {userHasGrant} from '../src/modules/rbac/permission-group-service.js';
import {adminPurgeRoutes} from '../src/modules/contacts/admin-purge-routes.js';
import {modulePolicy,strictModuleAccess} from '../src/modules/rbac/module-access.js';
import {RESOURCES,RESOURCE_ACTIONS,sanitizeGrants} from '../src/modules/rbac/permission-types.js';

beforeEach(()=>{
  vi.clearAllMocks();state.role='admin';state.granted=false;state.active=true;state.archived=false;
  state.findUser.mockImplementation(async()=>({role:state.role,isActive:state.active,permissionGroupId:'group',permissionGroup:{grants:{contact_data_purge:{access:state.granted},contact:{access:true,delete:true},settings:{access:true}},archivedAt:state.archived?new Date():null}}));
  state.targets.mockResolvedValue([]);
  state.preview.mockResolvedValue({confirmPhrase:'employee@example.invalid',accounts:[{id:'nick'}]});
  state.execute.mockResolvedValue({accountsPaused:['nick']});state.resume.mockResolvedValue(['nick']);
});
const scenarios=[
  {role:'owner',grant:false,allowed:true},
  {role:'admin',grant:true,allowed:true},
  {role:'admin',grant:false,allowed:false},
  {role:'member',grant:true,allowed:false},
  {role:'manager',grant:true,allowed:false},
];
describe('customer data purge has a dedicated admin-only grant',()=>{
  it('registers a separate permission, independent of normal contact.delete',()=>{
    expect(RESOURCES).toContain('contact_data_purge');expect(RESOURCE_ACTIONS.contact_data_purge).toEqual(['access']);
    expect(sanitizeGrants({contact_data_purge:{access:true,delete:true}})).toEqual({contact_data_purge:{access:true}});
    for(const endpoint of ['targets','preview','execute','resume'])expect(modulePolicy(`/api/v1/admin/contact-purge/${endpoint}`,'POST')).toEqual([[['contact_data_purge','access']]]);
  });
  it.each(scenarios)('role=$role, grant=$grant -> allowed=$allowed',async(s)=>{
    state.role=s.role;state.granted=s.grant;
    expect(await userHasGrant('actor','contact_data_purge','access')).toBe(s.allowed);
  });
  it('denies disabled users and archived permission groups',async()=>{
    state.granted=true;state.active=false;
    expect(await userHasGrant('actor','contact_data_purge','access')).toBe(false);
    state.active=true;state.archived=true;
    expect(await userHasGrant('actor','contact_data_purge','access')).toBe(false);
  });
  for(const globalGuard of [false,true])for(const endpoint of ['targets','preview','execute','resume']){
    it.each(scenarios)(`${globalGuard?'global + route':'route alone'} ${endpoint}: $role/grant=$grant`,async(s)=>{
      state.role=s.role;state.granted=s.grant;
      const app=Fastify();if(globalGuard)app.addHook('preHandler',strictModuleAccess);
      await app.register(adminPurgeRoutes);
      const response=await app.inject({method:endpoint==='targets'?'GET':'POST',url:`/api/v1/admin/contact-purge/${endpoint}`,headers:{authorization:'synthetic'},...(endpoint==='targets'?{}:{payload:{userId:'employee',zaloAccountIds:['nick'],confirm:'employee@example.invalid'}})});
      expect(response.statusCode).toBe(s.allowed?200:403);
      if(!s.allowed){for(const service of [state.targets,state.preview,state.execute,state.resume])expect(service).not.toHaveBeenCalled();}
      await app.close();
    });
  }
  it('revoking the grant blocks the next request before reading data',async()=>{
    const app=Fastify();await app.register(adminPurgeRoutes);
    state.granted=true;
    expect((await app.inject({url:'/api/v1/admin/contact-purge/targets',headers:{authorization:'synthetic'}})).statusCode).toBe(200);
    state.granted=false;state.targets.mockClear();
    expect((await app.inject({url:'/api/v1/admin/contact-purge/targets',headers:{authorization:'synthetic'}})).statusCode).toBe(403);
    expect(state.targets).not.toHaveBeenCalled();await app.close();
  });
  it('retains confirmation checks before deletion for an authorized admin',async()=>{
    state.granted=true;const app=Fastify();await app.register(adminPurgeRoutes);
    const response=await app.inject({method:'POST',url:'/api/v1/admin/contact-purge/execute',headers:{authorization:'synthetic'},payload:{userId:'employee',confirm:'wrong@example.invalid'}});
    expect(response.statusCode).toBe(400);expect(state.execute).not.toHaveBeenCalled();await app.close();
  });
  it('rejects unauthenticated calls before any data access',async()=>{
    const app=Fastify();await app.register(adminPurgeRoutes);
    expect((await app.inject('/api/v1/admin/contact-purge/targets')).statusCode).toBe(401);
    expect(state.targets).not.toHaveBeenCalled();await app.close();
  });
});
