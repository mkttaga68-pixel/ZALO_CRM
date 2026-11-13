import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createSSRApp,h} from 'vue';
import {renderToString} from '@vue/server-renderer';
const state=vi.hoisted(()=>({grants:new Set<string>(),path:'/chat'}));
vi.mock('@/stores/auth',()=>({useAuthStore:()=>({user:{id:'u',fullName:'Sale',email:'sale@example.invalid',orgName:'CRM',role:'admin'},hasGrant:(r:string,a='access')=>state.grants.has(`${r}.${a}`),logout:vi.fn()})}));
vi.mock('vue-router',async()=>{
  const {h}=await import('vue');
  return {useRoute:()=>({path:state.path}),useRouter:()=>({push:vi.fn()}),RouterLink:{props:['to'],setup:(p:any,c:any)=>()=>h('a',{'data-to':p.to},c.slots.default?.())}};
});
vi.mock('vuetify',()=>({useTheme:()=>({global:{name:{value:'light'}}})}));
vi.mock('@/components/AiqcAlertBell.vue',()=>({default:{template:'<span>AIQC_ALERT_COMPONENT</span>'}}));
vi.mock('@/components/NotificationBell.vue',()=>({default:{template:'<span>NOTICE_COMPONENT</span>'}}));
vi.mock('@/components/GlobalSearch.vue',()=>({default:{template:'<span>SEARCH_COMPONENT</span>'}}));
vi.mock('@/components/ui/ToastContainer.vue',()=>({default:{template:'<span></span>'}}));
vi.mock('@/components/ExtensionSlot.vue',()=>({default:{template:'<span></span>'}}));
vi.mock('@/components/ai/DailyBriefFab.vue',()=>({default:{template:'<span>AI_COMPONENT</span>'}}));
import DefaultLayout from '@/layouts/DefaultLayout.vue';
import BottomNav from '@/components/BottomNav.vue';
import {useSettingsNav} from '@/composables/use-settings-nav';

beforeEach(()=>{state.grants.clear();vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});});
async function render(component:any){
  const app=createSSRApp(component);
  const stub={props:['title','to'],setup:(p:any,c:any)=>()=>h('div',{'data-to':p.to},[p.title,c.slots.default?.(),c.slots.activator?.({props:{}})])};
  for(const name of ['v-app','v-main','v-menu','v-list','v-list-item','v-list-subheader','v-divider','v-icon','v-bottom-navigation','v-btn'])app.component(name,stub);
  app.config.warnHandler=()=>{};
  return (await renderToString(app)).replace(/<!--[\s\S]*?-->/g,'');
}
describe('rendered navigation respects grants',()=>{
  it('desktop hides ungranted modules even with legacy admin role',async()=>{
    state.grants.add('conversation.access');
    const html=await render(DefaultLayout);
    expect(html).toContain('Tin nhắn');
    for(const label of ['Khách hàng','KH đình trệ','Lịch hẹn','Báo cáo','Phân tích','Tài khoản Zalo','Vai trò &amp; Phân quyền','API &amp; Webhook','Đăng bài','Bot-Auto','Automation','SEARCH_COMPONENT','NOTICE_COMPONENT','AI_COMPONENT'])expect(html,label).not.toContain(label);
  });
  it('mobile only renders granted tabs',async()=>{
    state.grants.add('contact.access');
    const html=await render(BottomNav);
    expect(html).toContain('Khách hàng');
    expect(html).not.toContain('Chat');expect(html).not.toContain('Lịch hẹn');expect(html).not.toContain('Tổng quan');
  });
  it('settings sidebar and search use the same grant boundary',async()=>{
    state.grants.add('user.access');
    let result:any;
    await render({setup(){const nav=useSettingsNav();result={items:nav.visibleGroups.value.flatMap(g=>g.items.map(i=>i.route)),search:nav.searchItems('quyền')};return()=>h('div');}});
    expect(result.items).toContain('/settings/rbac/users');
    expect(result.items).not.toContain('/settings/rbac/permission-groups');
    expect(result.items).not.toContain('/settings/dev/api');
    expect(result.search).toEqual([]);
  });
});
