import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createRenderer,defineComponent,h,nextTick,ssrContextKey} from 'vue';
import Warnings from '../src/views/ai-quality-control/DepartmentJobWarnings.vue';
const mocks=vi.hoisted(()=>({request:vi.fn()}));
vi.mock('../src/api/ai-quality-control',()=>({qcRequest:mocks.request}));
type Node={tag:string;text:string;props:Record<string,any>;children:Node[];parent:Node|null};
const node=(tag:string,text=''):Node=>({tag,text,props:{},children:[],parent:null});
const renderer=createRenderer<Node,Node>({
  createElement:tag=>node(tag),createText:text=>node('#text',text),createComment:text=>node('#comment',text),
  setText:(n,t)=>{n.text=t;},setElementText:(n,t)=>{n.text=t;n.children=[];},
  parentNode:n=>n.parent,nextSibling:n=>n.parent?.children[n.parent.children.indexOf(n)+1]??null,
  patchProp:(n,k,_prev,v)=>{n.props[k]=v;},
  insert(n,parent,anchor){if(n.parent){const old=n.parent.children.indexOf(n);if(old>=0)n.parent.children.splice(old,1);}n.parent=parent;const i=anchor?parent.children.indexOf(anchor):-1;if(i<0)parent.children.push(n);else parent.children.splice(i,0,n);},
  remove(n){if(n.parent)n.parent.children.splice(n.parent.children.indexOf(n),1);n.parent=null;},
});
const descendants=(n:Node):Node[]=>[n,...n.children.flatMap(descendants)];
const text=(n:Node):string=>n.text+n.children.map(text).join('');
const job=(id:string,code:string)=>({id,state:'DEAD',errorCode:code,attempts:5,createdAt:'2026-11-13T01:00:00Z',updatedAt:'2026-11-13T02:00:00Z',canRetry:true});
async function settle(){await new Promise(resolve=>setTimeout(resolve,0));await nextTick();}
function mount(){const root=node('root');const app=renderer.createApp(Warnings,{departmentId:'dept-a',enabled:true,canRetry:true});app.provide(ssrContextKey,{modules:new Set()});app.config.warnHandler=()=>{};const stub=defineComponent({setup(_,{slots}){return()=>h('div',slots.default?.());}});for(const name of ['v-icon','v-chip','v-alert','v-spacer','v-btn'])app.component(name,stub);app.mount(root);return {root,app};}
beforeEach(()=>{mocks.request.mockReset();mocks.request.mockResolvedValue({items:[job('resource-a','OLLAMA_RESOURCE_LIMIT'),job('budget-b','AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED')],nextOffset:null,budget:{daily:20000,reserved:16363,remaining:3637}});});
describe('department warning disclosure',()=>{
  it('starts closed without requesting jobs and only fetches after the user opens it',async()=>{
    const {root,app}=mount();await settle();expect(mocks.request).not.toHaveBeenCalled();expect(text(root)).not.toContain('Nguyên nhân:');
    const outer=descendants(root).find(n=>n.tag==='details')!;expect(outer.props.open).toBeUndefined();outer.props.onToggle({currentTarget:{open:true}});await settle();
    expect(mocks.request).toHaveBeenCalledWith('get','/department-monitoring/departments/dept-a/jobs',{offset:0});
    const details=descendants(root).filter(n=>n.tag==='details');expect(details).toHaveLength(3);expect(details.every(n=>!n.props.open)).toBe(true);
    expect(text(root)).toContain('Máy chủ chưa đủ tài nguyên');expect(text(root)).toContain('Đã đạt giới hạn phân tích');expect(text(root)).toContain('3.637');
    expect(mocks.request.mock.calls.every(c=>c[0]==='get')).toBe(true);app.unmount();
  });
  it('does not submit work on close/reopen and hides the list when collapsed',async()=>{
    const {root,app}=mount();const outer=descendants(root).find(n=>n.tag==='details')!;
    outer.props.onToggle({currentTarget:{open:true}});await settle();outer.props.onToggle({currentTarget:{open:false}});await settle();expect(text(root)).not.toContain('Nguyên nhân:');
    outer.props.onToggle({currentTarget:{open:true}});await settle();expect(mocks.request).toHaveBeenCalledTimes(1);app.unmount();
  });
  it('reports an unavailable backend and permits a later reopen to retry loading',async()=>{
    mocks.request.mockRejectedValue({response:{status:404}});const {root,app}=mount();const outer=descendants(root).find(n=>n.tag==='details')!;
    outer.props.onToggle({currentTarget:{open:true}});await settle();expect(text(root)).toContain('Cần cập nhật backend');expect(text(root)).not.toContain('Chưa có cảnh báo');
    outer.props.onToggle({currentTarget:{open:false}});await settle();outer.props.onToggle({currentTarget:{open:true}});await settle();expect(mocks.request).toHaveBeenCalledTimes(2);app.unmount();
  });
  it('submits only the explicitly selected job with its displayed version',async()=>{
    const {root,app}=mount();descendants(root).find(n=>n.tag==='details')!.props.onToggle({currentTarget:{open:true}});await settle();
    const action=descendants(root).find(n=>n.props.onClick && text(n)==='Thử lại lượt này')!;expect(action).toBeDefined();await action.props.onClick();await settle();
    expect(mocks.request).toHaveBeenCalledWith('post','/department-monitoring/departments/dept-a/jobs/resource-a/retry',{expectedUpdatedAt:'2026-11-13T02:00:00Z'});
    expect(mocks.request.mock.calls.filter(c=>c[0]==='post')).toHaveLength(1);expect(text(root)).toContain('Đã đưa lượt này vào hàng đợi');app.unmount();
  });
});
