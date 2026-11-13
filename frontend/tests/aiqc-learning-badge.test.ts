import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createSSRApp,defineComponent,h,ref} from 'vue';
import {renderToString} from '@vue/server-renderer';
const mock=vi.hoisted(()=>({request:vi.fn(),handlers:{} as Record<string,(...a:unknown[])=>void>,connects:0}));
vi.mock('../src/api/ai-quality-control',()=>({qcRequest:mock.request}));
vi.mock('../src/api/index',()=>({readToken:()=>'synthetic-token'}));
vi.mock('socket.io-client',()=>({io:()=>({on:(e:string,fn:(...a:unknown[])=>void)=>{mock.handlers[e]=fn;},connect:()=>{mock.connects++;},disconnect:()=>{}})}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,onMounted:vue.onServerPrefetch};});
import Dashboard from '../src/views/ai-quality-control/AIQualityControlDashboard.vue';
import {learningPollInterval,useLearningDraftSignal} from '../src/views/ai-quality-control/learning-signal';
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();await new Promise(r=>setImmediate(r));};
let pending=3;
const workspace=(permissions:string[])=>({authorityEpoch:0,indexVersion:0,permissions,settings:{provider:'mock',model:'',vaultPath:'',maxOutputTokens:1000,requestsPerMinute:5,dailyTokenBudget:20000,retentionDays:null,inputUsdPerMillion:null,outputUsdPerMillion:null},documents:[],runs:[],datasets:[],evaluations:[],audits:[],care:{},offDay:[],employees:[],connectionTests:[]});
function respond(permissions:string[]){mock.request.mockImplementation(async(_m:string,url:string)=>url==='/status'?{storageMode:'memory',syntheticOnly:true,availability:{},provider:{apiKeyConfigured:false,models:[],realApiEnabled:false,outboundTestApproved:false},scenarios:[]}:url==='/learning-drafts/summary'?{pending,changesRequested:0,latestDetectedAt:null,version:1}:workspace(permissions));}
async function renderDashboard(){const app=createSSRApp(Dashboard);app.config.warnHandler=()=>{};const tag=defineComponent({setup(_,{slots}){return()=>h('section',slots.default?.());}});for(const name of ['v-container','v-alert','v-tabs','v-tab','v-btn','v-row','v-col','v-card','v-table','v-spacer','v-progress-linear','v-icon','v-text-field','v-skeleton-loader'])app.component(name,tag);const html=await renderToString(app);await flush();return html;}
beforeEach(()=>{pending=3;mock.request.mockReset();mock.handlers={};mock.connects=0;vi.stubGlobal('document',{hidden:false,addEventListener(){},removeEventListener(){}});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('AIQC Learning Draft badge in "Kho quy tắc"',()=>{
  it('polling fallback is faster while realtime is disconnected',()=>{expect(learningPollInterval(false)).toBe(60000);expect(learningPollInterval(true)).toBe(300000);});
  it('Admin (approve) loads the pending count and opens the realtime socket once permissions arrive',async()=>{
    respond(['access','approve']);
    // Minimal client renderer (no DOM library): watchers run as in the browser.
    const {createRenderer}=await import('@vue/runtime-core');
    type N={children:N[]};const node=():N=>({children:[]});
    const {createApp}=createRenderer<N,N>({createElement:node,createText:node,createComment:node,insert:(c,p)=>{p.children.push(c);},remove:()=>{},setText:()=>{},setElementText:()=>{},parentNode:()=>null,nextSibling:()=>null,patchProp:()=>{}});
    const enabled=ref(false);let state:ReturnType<typeof useLearningDraftSignal>|undefined;
    const app=createApp(defineComponent({setup(){state=useLearningDraftSignal(enabled);return()=>h('i');}}));app.mount(node());
    await flush();
    expect(mock.request).not.toHaveBeenCalled();
    enabled.value=true;await flush();
    expect(mock.request).toHaveBeenCalledWith('get','/learning-drafts/summary');
    expect(mock.connects).toBe(1);
    expect(state!.summary.value?.pending).toBe(3);
    enabled.value=false;await flush();
    expect(state!.summary.value).toBeNull();
    app.unmount();
  });
  it('users without approve never request drafts nor open the learning socket',async()=>{
    respond(['access','create']);
    const html=await renderDashboard();
    expect(mock.request).not.toHaveBeenCalledWith('get','/learning-drafts/summary');
    expect(mock.connects).toBe(0);
    expect(html).not.toContain('bài học AI chờ duyệt');
  });
  it('realtime signal from another Admin refreshes the count (no stale badge); polling covers socket outage',async()=>{
    vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    respond(['access','approve']);
    let state:ReturnType<typeof useLearningDraftSignal>|undefined;
    const Harness=defineComponent({setup(){state=useLearningDraftSignal(ref(true));return()=>h('i');}});
    await renderToString(createSSRApp(Harness));await flush();
    expect(state!.summary.value?.pending).toBe(3);
    mock.handlers.connect?.();await flush();
    expect(state!.live.value).toBe(true);
    pending=2;mock.handlers['aiqc:learning-drafts-changed']?.({draftId:'x',status:'APPROVED'});await flush();
    expect(state!.summary.value?.pending).toBe(2);
    expect(state!.revision.value).toBe(1);
    mock.handlers.disconnect?.();pending=0;
    const calls=mock.request.mock.calls.length;
    vi.advanceTimersByTime(60000);await flush();
    expect(mock.request.mock.calls.length).toBeGreaterThan(calls);
    expect(state!.summary.value?.pending).toBe(0);
  });
  it('keeps every existing "Kho quy tắc" function and moves the inbox to its own Admin-only "Bài học AI" tab',()=>{
    const src=readFileSync(new URL('../src/views/ai-quality-control/AIQualityControlDashboard.vue',import.meta.url),'utf8');
    for(const needle of ['Thư mục tài liệu Obsidian','Lưu đường dẫn','@click="saveSettings"','Xem trước','@click="previewVault"','Đồng bộ bản nháp','@click="syncVault"','<KnowledgeDocumentLibrary','publishDocument','revokeDocument',"'/knowledge/sync'","'/knowledge/preview'"])expect(src).toContain(needle);
    expect(src).toContain('<section v-if="tab===11 && learningEnabled"');
    expect(src.match(/<LearningDraftInbox /g)!.length).toBe(1);
    expect(src).toContain('item.value===11 && learningPending');
    expect(src).toContain('qc-learning-badge');
    expect(src).toContain('@click="tab=11"');
    expect(src).toContain("item.value!==11||learningEnabled.value");
    expect(src).not.toMatch(/Learning Center/);
    const items=src.match(/const navigationItems=\[(.*?)\];/)![1]!;
    expect(items.match(/value:/g)!.length).toBe(10);
    expect(items).toContain("{value:11,group:'setup',label:'Bài học AI'");
    // "Huấn luyện" đã bỏ, thay bằng "Lưu trữ tin nhắn".
    expect(items).not.toContain('Huấn luyện');
    expect(items).toContain("{value:12,group:'work',label:'Lưu trữ tin nhắn'");
    expect(src).toContain('<section v-if="tab===12" class="mt-5"><CustomerMessageArchive');
  });
});
