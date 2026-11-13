import {beforeEach,describe,expect,it,vi} from 'vitest';
import Fastify from 'fastify';
const mocks=vi.hoisted(()=>({grants:new Set<string>(),auth:vi.fn(),userHasGrant:vi.fn()}));
vi.mock('../src/modules/auth/auth-middleware.js',()=>({authMiddleware:mocks.auth}));
vi.mock('../src/modules/rbac/permission-group-service.js',()=>({userHasGrant:mocks.userHasGrant}));
import {modulePolicy,strictModuleAccess} from '../src/modules/rbac/module-access.js';
import {hasGrant,RESOURCES,RESOURCE_ACTIONS} from '../src/modules/rbac/permission-types.js';
import {canAccessPath,canUseGlobalSearch,canUseNotifications,firstAllowedPath} from '../../frontend/src/router/access-policy.js';

beforeEach(()=>{
  vi.clearAllMocks(); mocks.grants.clear();
  mocks.auth.mockImplementation(async(req:any,reply:any)=>{
    if(!req.headers.authorization){reply.code(401).send({error:'Unauthorized'});return;}
    req.user={id:'employee',orgId:'org',role:req.headers['x-test-role']??'member'};
  });
  mocks.userHasGrant.mockImplementation(async(_id:string,r:string,a:string)=>mocks.grants.has(`${r}.${a}`));
});

describe('strict module boundary',()=>{
  const cases=[
    ['/api/v1/contacts','contact'],['/api/v1/conversations','conversation'],
    ['/api/v1/permission-groups','permission_group'],['/api/v1/permission-groups/meta','permission_group'],
    ['/api/v1/permission-groups/:id','permission_group'],['/api/v1/rbac/users','user'],
    ['/api/v1/departments','department'],['/api/v1/dashboard/kpi','dashboard'],
    ['/api/v1/appointments','appointment'],['/api/v1/reports/messages','report'],
    ['/api/v1/analytics/team-performance','analytics'],['/api/v1/automation/rules','automation'],
    ['/api/v1/automation/blocks','block'],['/api/v1/automation/block-folders','block'],
    ['/api/v1/automation/sequences','sequence'],['/api/v1/automation/triggers','trigger'],
    ['/api/v1/automation/broadcasts','broadcast'],['/api/v1/customer-lists','customer_list'],
    ['/api/v1/ai-quality-control/workspace','ai_quality_control'],['/api/v1/integrations','integration'],
    ['/api/v1/zalo-accounts/:accountId/groups','group'],['/api/v1/zalo-accounts/enriched','zalo_account'],
    ['/api/v1/settings/webhook','webhook'],['/api/v1/settings/api-key','webhook'],
    ['/api/v1/group-auto-reply/config','settings'],['/api/v1/auto-reply/config','settings'],
    ['/api/v1/telegram/status','settings'],['/api/v1/manual-posting/jobs','posting'],
  ];
  it.each(cases)('blocks %s before business handler, including legacy admin',async(url,resource)=>{
    const app=Fastify(); let reads=0;
    app.addHook('preHandler',strictModuleAccess);
    app.get(url,async()=>{reads++;return{secret:'protected'};});
    const actual=url.replace(':id','some-id').replace(':accountId','nick');
    const denied=await app.inject({url:actual,headers:{authorization:'test','x-test-role':'admin'}});
    expect(denied.statusCode).toBe(403);expect(reads).toBe(0);
    mocks.grants.add(`${resource}.access`);
    const allowed=await app.inject({url:actual,headers:{authorization:'test'}});
    expect(allowed.statusCode).toBe(200);expect(reads).toBe(1);
    mocks.grants.clear();
    expect((await app.inject({url:actual,headers:{authorization:'test'}})).statusCode).toBe(403);
    expect(reads).toBe(1);await app.close();
  });
  it('checks access and the individual write action',async()=>{
    const app=Fastify();app.addHook('preHandler',strictModuleAccess);
    app.post('/api/v1/contacts',async()=>({ok:true}));
    mocks.grants.add('contact.create');
    expect((await app.inject({method:'POST',url:'/api/v1/contacts',headers:{authorization:'test'}})).statusCode).toBe(403);
    mocks.grants.add('contact.access');
    expect((await app.inject({method:'POST',url:'/api/v1/contacts',headers:{authorization:'test'}})).statusCode).toBe(200);
    mocks.grants.delete('contact.create');
    expect((await app.inject({method:'POST',url:'/api/v1/contacts',headers:{authorization:'test'}})).statusCode).toBe(403);
    await app.close();
  });
  it('does not let user editors assign themselves a permission group',async()=>{
    const app=Fastify();app.addHook('preHandler',strictModuleAccess);
    app.patch('/api/v1/rbac/users/:id/permission-group',async()=>({ok:true}));
    mocks.grants.add('user.access');mocks.grants.add('user.edit');
    const request={method:'PATCH' as const,url:'/api/v1/rbac/users/employee/permission-group',headers:{authorization:'test'},payload:{permissionGroupId:'admin'}};
    expect((await app.inject(request)).statusCode).toBe(403);
    mocks.grants.add('permission_group.edit');
    expect((await app.inject(request)).statusCode).toBe(200);
    await app.close();
  });
  it('rejects anonymous and unknown module requests; fails closed on DB failure',async()=>{
    const app=Fastify();app.addHook('preHandler',strictModuleAccess);
    app.get('/api/v1/contacts',async()=>({secret:true}));app.get('/api/v1/unmapped',async()=>({secret:true}));
    expect((await app.inject('/api/v1/contacts')).statusCode).toBe(401);
    expect((await app.inject({url:'/api/v1/unmapped',headers:{authorization:'test'}})).statusCode).toBe(403);
    mocks.userHasGrant.mockRejectedValueOnce(Error('unavailable'));
    expect((await app.inject({url:'/api/v1/contacts',headers:{authorization:'test'}})).statusCode).toBe(503);
    await app.close();
  });
  it('leaves public login, self-service and signed integrations to their existing auth',()=>{
    for(const p of ['/api/v1/auth/login','/api/v1/setup/status','/api/v1/profile','/api/v1/me/preferences','/api/v1/privacy/unlock','/api/v1/integrations/facebook/webhook','/api/v1/integrations/facebook/oauth/callback','/api/v1/automation/webhooks/order','/api/public/contacts'])expect(modulePolicy(p,'GET'),p).toBeNull();
  });
});

describe('resource access is mandatory for every operation',()=>{
  for(const resource of RESOURCES)for(const action of RESOURCE_ACTIONS[resource]){
    if(action==='access')continue;
    it(`${resource}.${action} cannot outlive ${resource}.access`,()=>{
      const grants:any={[resource]:{[action]:true},bot_auto:{access:true}};
      expect(hasGrant(grants,resource,action)).toBe(false);
      grants[resource].access=true;expect(hasGrant(grants,resource,action)).toBe(true);
      grants[resource].access=false;expect(hasGrant(grants,resource,action)).toBe(false);
    });
  }
});

describe('navigation and URL policy',()=>{
  const only=(resource:string)=>(r:string)=>r===resource;
  it('shows only granted modules and blocks manually entered settings URLs',()=>{
    expect(canAccessPath('/chat/123',only('conversation'))).toBe(true);
    for(const p of ['/contacts','/reports','/settings/team/roles','/settings/rbac/permission-groups','/settings/dev/api','/settings/org/profile','/settings/channels/zalo'])expect(canAccessPath(p,only('conversation')),p).toBe(false);
    expect(firstAllowedPath(only('conversation'))).toBe('/chat');
    expect(firstAllowedPath(()=>false)).toBe('/settings/personal/profile');
  });
  it('uses grants for settings rather than a broad legacy admin role',()=>{
    expect(canAccessPath('/settings/rbac/users',only('user'))).toBe(true);
    expect(canAccessPath('/settings/rbac/permission-groups',only('user'))).toBe(false);
    expect(canAccessPath('/settings/personal/password',()=>false)).toBe(true);
    expect(canAccessPath('/settings/unknown',()=>true)).toBe(false);
  });
  it('hides mixed-data search and notifications unless every returned category is authorized',()=>{
    expect(canUseGlobalSearch(only('contact'))).toBe(false);
    expect(canUseNotifications(only('conversation'))).toBe(false);
    expect(canUseGlobalSearch(()=>true)).toBe(true);
    expect(canUseNotifications(()=>true)).toBe(true);
  });
});
