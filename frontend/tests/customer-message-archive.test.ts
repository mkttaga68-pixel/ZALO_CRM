import {describe,expect,it,vi,beforeEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from '@vue/server-renderer';
const mock=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/api/ai-quality-control',()=>({qcRequest:mock.request}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,onMounted:vue.onServerPrefetch};});
import Archive from '../src/views/ai-quality-control/CustomerMessageArchive.vue';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
async function render(){const app=createSSRApp(Archive);app.config.warnHandler=()=>{};const tag=defineComponent({setup(_,{slots}){return()=>h('section',slots.default?.());}});for(const name of ['v-alert','v-btn','v-btn-toggle','v-icon','v-text-field','v-skeleton-loader'])app.component(name,tag);const html=await renderToString(app);await flush();return html;}
const status={enabled:true,schedule:{hour:22,minute:0,timeZone:'Asia/Ho_Chi_Minh'},blockers:[],lastRun:null,lastSuccess:{status:'DONE',trigger:'SCHEDULE',startedAt:'2026-11-12T15:00:00Z',finishedAt:'2026-11-12T15:01:00Z',savedUntil:'2026-11-12T15:00:00Z',messages:12,customers:3,errorCode:null},totals:{messages:120,customers:9},canRunNow:true};
beforeEach(()=>{mock.request.mockReset();});
describe('Lưu trữ tin nhắn (tự động hằng đêm)',()=>{
  it('shows the nightly schedule, what was saved and recently archived customers — no manual save per customer',async()=>{
    mock.request.mockImplementation(async(_m:string,url:string)=>url==='/customer-archive/status'?status:{customers:[{contactId:'c1',name:'Chị Lan',phone:'0912345678',customerMessages:12,ourMessages:9,lastMessageAt:null}]});
    const html=await render();
    expect(mock.request).toHaveBeenCalledWith('get','/customer-archive/status');
    expect(mock.request).toHaveBeenCalledWith('get','/customer-archive/search',{q:''});
    expect(html).toContain('Đang bật · lưu lúc 22:00 mỗi đêm');
    expect(html).toContain('120 tin · 9 khách');
    expect(html).toContain('Chị Lan');expect(html).toContain('0912345678');expect(html).toContain('12 tin khách');
    expect(html).toContain('Lưu ngay');
    expect(html).not.toContain('Bỏ lưu');expect(html).not.toContain('Khách đã lưu');
  });
  it('never posts a per-customer save when a customer is opened',()=>{
    const src=readFileSync(new URL('../src/views/ai-quality-control/CustomerMessageArchive.vue',import.meta.url),'utf8');
    expect(src).toContain("qcRequest<ArchiveDetail>('get',`/customer-archive/${id}`)");
    expect(src).not.toMatch(/'post',`\/customer-archive\/\$\{id\}`/);
    expect(src).not.toContain("'delete'");
  });
  it('shows a clear message when real CRM data is not enabled',async()=>{
    mock.request.mockRejectedValue({response:{status:403,data:{error:'AI_QC_REAL_DATA_DISABLED'}}});
    const html=await render();
    expect(html).toContain('Chưa bật đọc dữ liệu CRM thật');
  });
});
