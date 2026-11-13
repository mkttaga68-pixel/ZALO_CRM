import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({actor:vi.fn(),grant:vi.fn(),account:vi.fn(),conversation:vi.fn(),friend:vi.fn(),scope:vi.fn()}));
vi.mock('../src/modules/auth/active-session.js',()=>({assertActiveActor:mocks.actor}));
vi.mock('../src/modules/rbac/permission-group-service.js',()=>({userHasGrant:mocks.grant}));
vi.mock('../src/shared/database/prisma-client.js',()=>({prisma:{zaloAccount:{findFirst:mocks.account},conversation:{findFirst:mocks.conversation},friend:{findFirst:mocks.friend}}}));
vi.mock('../src/modules/zalo/zalo-scope.js',()=>({getZaloScope:mocks.scope}));
import {mayReceiveModuleEvent,RbacSocketAdapter} from '../src/shared/rbac-socket-adapter.js';
const socket:any={data:{identity:{userId:'sale',orgId:'org-a',role:'member'}}};
const options={rooms:new Set(['org:org-a'])};
beforeEach(()=>{vi.clearAllMocks();mocks.actor.mockResolvedValue(undefined);mocks.grant.mockResolvedValue(true);mocks.account.mockResolvedValue({privacyMode:'work'});mocks.conversation.mockResolvedValue({zaloAccountId:'nick-a'});mocks.scope.mockResolvedValue({accessibleIds:['nick-a']});});
describe('outgoing realtime module authorization',()=>{
  it('allows the granted module within nick scope',async()=>{
    expect(await mayReceiveModuleEvent(socket,{data:['chat:message',{conversationId:'conv-a'}]},options)).toBe(true);
    expect(mocks.grant).toHaveBeenCalledWith('sale','conversation','access');
  });
  it('denies denied/revoked modules even when the socket already joined the org room',async()=>{
    mocks.grant.mockResolvedValue(false);
    expect(await mayReceiveModuleEvent(socket,{data:['chat:message',{conversationId:'conv-a'}]},options)).toBe(false);
    expect(mocks.conversation).not.toHaveBeenCalled();
  });
  it('blocks global broadcasts from another organization/account',async()=>{
    mocks.account.mockResolvedValue(null);
    expect(await mayReceiveModuleEvent(socket,{data:['friend:event',{accountId:'foreign-nick'}]},{rooms:new Set()})).toBe(false);
    mocks.account.mockResolvedValue({privacyMode:'work'});mocks.scope.mockResolvedValue({accessibleIds:[]});
    expect(await mayReceiveModuleEvent(socket,{data:['chat:message',{conversationId:'outside-scope'}]},options)).toBe(false);
  });
  it('does not deliver private nick content without a PIN-aware request',async()=>{
    mocks.account.mockResolvedValue({privacyMode:'main'});
    expect(await mayReceiveModuleEvent(socket,{data:['chat:message',{conversationId:'private'}]},options)).toBe(false);
  });
  it('denies other org rooms, unclassified events and missing scope',async()=>{
    expect(await mayReceiveModuleEvent(socket,{data:['chat:message',{accountId:'nick-a'}]},{rooms:new Set(['org:org-b'])})).toBe(false);
    expect(await mayReceiveModuleEvent(socket,{data:['unknown:secret',{accountId:'nick-a'}]},options)).toBe(false);
    expect(await mayReceiveModuleEvent(socket,{data:['chat:message',{}]},options)).toBe(false);
  });
  it('checks management grant before delivering QR login data',async()=>{
    mocks.grant.mockImplementation(async(_u,r,a)=>a!=='edit');
    expect(await mayReceiveModuleEvent(socket,{data:['zalo:qr',{accountId:'nick-a'}]},options)).toBe(false);
  });
  it('filters real adapter broadcasts and preserves exclusions and order',async()=>{
    const makeSocket=(id:string)=>({id,data:{identity:{userId:id,orgId:'org-a',role:'member'}},client:{writeToEngine:vi.fn()},notifyOutgoingListeners:vi.fn()});
    const allowed=makeSocket('allowed'),denied=makeSocket('denied'),excluded=makeSocket('excluded');
    const nsp:any={name:'/',server:{encoder:{encode:(packet:any)=>[JSON.stringify(packet)]}},sockets:new Map([['allowed',allowed],['denied',denied],['excluded',excluded]])};
    const adapter=new RbacSocketAdapter(nsp);
    for(const s of [allowed,denied,excluded])adapter.addAll(s.id,new Set([s.id,'org:org-a']));
    mocks.grant.mockImplementation(async(id)=>id!=='denied');
    adapter.broadcast({type:2,data:['chat:message',{conversationId:'conv-a',order:1}]},{rooms:new Set(['org:org-a']),except:new Set(['excluded'])});
    adapter.broadcast({type:2,data:['chat:message',{conversationId:'conv-a',order:2}]},{rooms:new Set(['org:org-a']),except:new Set(['excluded'])});
    await (adapter as any).delivery;
    expect(allowed.client.writeToEngine).toHaveBeenCalledTimes(2);
    expect(denied.client.writeToEngine).not.toHaveBeenCalled();expect(excluded.client.writeToEngine).not.toHaveBeenCalled();
    expect(JSON.parse(allowed.client.writeToEngine.mock.calls[0][0][0]).data[1].order).toBe(1);
    expect(JSON.parse(allowed.client.writeToEngine.mock.calls[1][0][0]).data[1].order).toBe(2);
  });
  it('blocks global events when permissions are revoked after connection',async()=>{
    const s:any={id:'connected',data:socket.data,client:{writeToEngine:vi.fn()}};
    const nsp:any={name:'/',server:{encoder:{encode:()=>['packet']}},sockets:new Map([[s.id,s]])};
    const adapter=new RbacSocketAdapter(nsp);adapter.addAll(s.id,new Set([s.id]));
    mocks.grant.mockResolvedValue(false);
    adapter.broadcast({type:2,data:['chat:typing',{conversationId:'conv-a'}]},{rooms:new Set()});
    await (adapter as any).delivery;
    expect(s.client.writeToEngine).not.toHaveBeenCalled();
  });
  it('does not deliver if the persisted actor changed organization or role',async()=>{
    const s:any={id:'stale',data:socket.data,client:{writeToEngine:vi.fn()}};
    const nsp:any={name:'/',server:{encoder:{encode:()=>['packet']}},sockets:new Map([[s.id,s]])};
    const adapter=new RbacSocketAdapter(nsp);adapter.addAll(s.id,new Set([s.id]));
    mocks.actor.mockRejectedValue(Error('stale actor'));
    adapter.broadcast({type:2,data:['chat:message',{conversationId:'conv-a'}]},{rooms:new Set()});
    await (adapter as any).delivery;
    expect(s.client.writeToEngine).not.toHaveBeenCalled();expect(mocks.grant).not.toHaveBeenCalled();
  });
});
