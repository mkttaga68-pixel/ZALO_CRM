import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from '@vue/server-renderer';
import Center from '../src/views/ai-quality-control/AIWarningCenter.vue';
const mocks=vi.hoisted(()=>({list:vi.fn(),health:vi.fn(),detail:vi.fn(),review:vi.fn(),handlers:{} as Record<string,(value:any)=>void>,socket:{on:vi.fn(),emit:vi.fn(),connect:vi.fn(),disconnect:vi.fn()}}));
vi.mock('../src/api/ai-qc-monitoring',()=>({monitoringApi:mocks}));
vi.mock('../src/api/index',()=>({readToken:()=> 'synthetic-ui-token'}));
vi.mock('socket.io-client',()=>({io:()=>mocks.socket}));
vi.mock('vue',async original=>{const vue=await original<typeof import('vue')>();return {...vue,onMounted:vue.onServerPrefetch};});
async function render(){const app=createSSRApp(Center,{permissions:['access']});app.config.warnHandler=()=>{};const tag=defineComponent({setup(_,{slots}){return()=>h('section',slots.default?.());}});for(const name of ['v-card','v-alert','v-btn','v-table','v-navigation-drawer','v-textarea'])app.component(name,tag);return renderToString(app);}
beforeEach(()=>{vi.clearAllMocks();mocks.handlers={};mocks.socket.on.mockImplementation((name:string,fn:any)=>{mocks.handlers[name]=fn;return mocks.socket;});mocks.list.mockResolvedValue({enabled:true,syntheticOnly:true,warnings:[],open:0});mocks.health.mockResolvedValue({enabled:true,syntheticOnly:true,provider:'mock',counts:{},heartbeat:null,deadLetters:0});});
describe('sandbox warning center SSR and event contract',()=>{
 it('renders empty state and health without claiming real AI or violations',async()=>{const html=await render();expect(html).toContain('Trung tâm cảnh báo thử nghiệm');expect(html).toContain('Dữ liệu mô phỏng');expect(html).toContain('Chưa có cảnh báo');expect(html).toContain('deadLetters');expect(mocks.socket.connect).toHaveBeenCalledTimes(1);});
 it('renders translated statuses and never renders untrusted backend labels as HTML',async()=>{mocks.list.mockResolvedValue({enabled:true,syntheticOnly:true,warnings:[{id:'fixture',category:'<img src=x onerror=alert(1)>',status:'OPEN',coverage:'UNKNOWN'}]});const html=await render();expect(html).not.toContain('<img src=x');expect(html).toContain('Chưa xác định');expect(html).toContain('Chưa xem');});
 it('feature unavailable/error never opens a realtime connection',async()=>{mocks.list.mockRejectedValue({response:{data:{error:'MONITORING_DISABLED'}}});const html=await render();expect(html).toContain('Giám sát thử nghiệm đang tắt');expect(mocks.socket.connect).not.toHaveBeenCalled();});
 it('rejects a non-synthetic backend capability before connecting',async()=>{mocks.list.mockResolvedValue({enabled:true,syntheticOnly:false,warnings:[]});const html=await render();expect(html).toContain('Giám sát thử nghiệm đang tắt hoặc chưa sẵn sàng');expect(mocks.socket.connect).not.toHaveBeenCalled();});
 it('health denial does not hide warnings the actor may read',async()=>{mocks.health.mockRejectedValue({response:{status:403}});const html=await render();expect(html).toContain('Chưa có cảnh báo');expect(html).not.toContain('deadLetters');expect(mocks.socket.connect).toHaveBeenCalled();});
 it('deduplicates stable notification IDs and ignores malformed events',async()=>{await render();const event=mocks.handlers['qc:warning-updated']!;event({id:'fixture-delivery'});await Promise.resolve();await Promise.resolve();const count=mocks.list.mock.calls.length;event({id:'fixture-delivery'});event({});await Promise.resolve();expect(mocks.list.mock.calls.length).toBe(count);expect(mocks.socket.emit).toHaveBeenCalledWith('qc:ack','fixture-delivery');});
});
