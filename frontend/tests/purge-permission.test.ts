import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createPinia,setActivePinia} from 'pinia';
vi.mock('@/api/index',()=>({api:{get:vi.fn(),post:vi.fn()}}));
vi.mock('@/composables/use-org-timezone',()=>({refreshOrgTimezone:vi.fn()}));
vi.mock('vue-router',()=>({useRoute:()=>({path:'/settings/org/data-purge'})}));
import {useAuthStore} from '@/stores/auth';
import {canAccessPath} from '@/router/access-policy';
import {useSettingsNav} from '@/composables/use-settings-nav';
beforeEach(()=>{
  const storage={getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()};
  vi.stubGlobal('localStorage',storage);vi.stubGlobal('sessionStorage',storage);
  setActivePinia(createPinia());
});
describe('purge UI: role and grant must both allow access',()=>{
  it.each([
    {role:'owner',grant:false,allowed:true},
    {role:'admin',grant:true,allowed:true},
    {role:'admin',grant:false,allowed:false},
    {role:'member',grant:true,allowed:false},
    {role:'manager',grant:true,allowed:false},
  ])('$role / grant=$grant -> allowed=$allowed',s=>{
    const auth=useAuthStore();
    auth.user={id:'actor',email:'actor@example.invalid',fullName:'Actor',orgId:'org',orgName:'Org',role:s.role,grants:{settings:{access:true},contact:{access:true,delete:true},contact_data_purge:{access:s.grant}}};
    expect(auth.hasGrant('contact_data_purge')).toBe(s.allowed);
    expect(canAccessPath('/settings/org/data-purge',auth.hasGrant)).toBe(s.allowed);
    const nav=useSettingsNav();
    expect(nav.visibleGroups.value.flatMap(g=>g.items).some(i=>i.id==='data-purge')).toBe(s.allowed);
    expect(nav.searchItems('xoa du lieu').some(i=>i.id==='data-purge')).toBe(s.allowed);
  });
  it('the dedicated grant works without a general settings grant',()=>{
    const auth=useAuthStore();
    auth.user={id:'actor',email:'actor@example.invalid',fullName:'Actor',orgId:'org',orgName:'Org',role:'admin',grants:{contact_data_purge:{access:true}}};
    expect(canAccessPath('/settings/org/data-purge',auth.hasGrant)).toBe(true);
    expect(canAccessPath('/settings/org/profile',auth.hasGrant)).toBe(false);
    auth.user.role='member';
    expect(canAccessPath('/settings/org/data-purge',auth.hasGrant)).toBe(false);
  });
});
