import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from '@vue/server-renderer';
import Manual from '../src/views/ai-quality-control/ManualCrmAnalysis.vue';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/api/ai-quality-control',()=>({qcRequest:mock.request}));
async function render(permissions:string[],retentionDays:number|null=7,apiReady=false){
 const app=createSSRApp(Manual,{permissions,retentionDays,apiReady});app.config.warnHandler=()=>{};
 const tag=defineComponent({setup(_,{slots}){return()=>h('section',slots.default?.());}});
 const button=defineComponent({props:{disabled:Boolean},setup(p,{slots}){return()=>h('button',{disabled:p.disabled},slots.default?.());}});
 for(const name of ['v-card','v-alert'])app.component(name,tag);app.component('v-btn',button);
 return renderToString(app);
}
beforeEach(()=>mock.request.mockReset());
describe('manual real-chat UI SSR, no browser/network',()=>{
 it('shows selected-conversation and privacy review guidance without loading any chat',async()=>{const html=await render(['access','create']);expect(html).toContain('Phân tích hội thoại');expect(html).toContain('Chứng cứ được lưu 7 ngày');expect(mock.request).not.toHaveBeenCalled();});
 it('has no automatic request even when API status says ready',async()=>{await render(['access','create','edit'],7,true);expect(mock.request).not.toHaveBeenCalled();});
 it('read-only user has disabled preview and no settings mutation control',async()=>{const html=await render(['access'],null);expect(html).toMatch(/<button[^>]*disabled[^>]*>Xem trước bản gửi/);expect(html).not.toContain('Đặt thời gian lưu 7 ngày');});
 it('editor with approval sees the explicit seven-day settings action',async()=>{expect(await render(['access','create','edit','approve'],null)).toContain('Đặt thời gian lưu 7 ngày');expect(await render(['access','create','edit','approve'],7)).not.toContain('Đặt thời gian lưu 7 ngày');});
 it('editor without approval cannot change retention',async()=>{expect(await render(['access','create','edit'],null)).not.toContain('??t th?i gian l?u 7 ng?y');});
 it('no send button is available before obtaining and checking a preview',async()=>{const html=await render(['access','create'],7,true);expect(html).not.toContain('Gửi hội thoại đã kiểm tra để phân tích');});
});
