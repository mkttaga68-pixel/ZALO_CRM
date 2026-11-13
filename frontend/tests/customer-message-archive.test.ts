import {describe,expect,it,vi,beforeEach} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from '@vue/server-renderer';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/api/ai-quality-control',()=>({qcRequest:mock.request}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,onMounted:vue.onServerPrefetch};});
import Archive from '../src/views/ai-quality-control/CustomerMessageArchive.vue';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
async function render(){const app=createSSRApp(Archive,{canApprove:false});app.config.warnHandler=()=>{};const tag=defineComponent({setup(_,{slots}){return()=>h('section',slots.default?.());}});for(const name of ['v-alert','v-btn','v-btn-toggle','v-icon','v-text-field','v-skeleton-loader'])app.component(name,tag);const html=await renderToString(app);await flush();return html;}
beforeEach(()=>{mock.request.mockReset();});
describe('Lưu trữ tin nhắn',()=>{
  it('loads saved customers and the search list (never message content) on open',async()=>{
    mock.request.mockImplementation(async(_m:string,url:string)=>url==='/customer-archive'?{items:[{contactId:'c1',name:'Chị Lan',savedAt:'2026-11-10T00:00:00Z',lastOpenedAt:'2026-11-10T00:00:00Z',openCount:2,savedByMe:true,customerMessages:12,ourMessages:9,lastActivity:null}]}:{customers:[{contactId:'c2',name:'Anh Minh',lastMessageAt:null,saved:false}]});
    const html=await render();
    expect(mock.request).toHaveBeenCalledWith('get','/customer-archive');
    expect(mock.request).toHaveBeenCalledWith('get','/customer-archive/search',{q:''});
    expect(html).toContain('Chị Lan');expect(html).toContain('12 tin khách');expect(html).toContain('Anh Minh');
    expect(html).toContain('Lưu trữ tin nhắn khách hàng');
  });
  it('shows a clear message when real CRM data is not enabled',async()=>{
    mock.request.mockRejectedValue({response:{status:403,data:{error:'AI_QC_REAL_DATA_DISABLED'}}});
    const html=await render();
    expect(html).toContain('Chưa bật đọc dữ liệu CRM thật');
  });
});
