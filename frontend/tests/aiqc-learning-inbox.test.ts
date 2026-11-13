import {beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createSSRApp,defineComponent,h} from 'vue';
import {renderToString} from '@vue/server-renderer';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../src/api/ai-quality-control',()=>({qcRequest:request}));
import Inbox from '../src/views/ai-quality-control/LearningDraftInbox.vue';

const health={storageMode:'postgres-sandbox',realtime:true,scheduler:{allowed:false,blockers:['PRODUCTION_NO_GO'],schedule:null,scopeTenantMatches:false},lastJob:null,jobsLast7Days:0,drafts:{total:0,open:0,pending:0,approved:0,rejected:0,expired:0,limit:300,openLimit:100},suppressions:0,outbox:{configured:true,pending:0,failed:2,lastErrorCodes:['LEARNING_OUTBOX_NOT_FOUND_OR_SYMLINK']},retention:{retentionDays:null,approved:false},alerts:['OBSIDIAN_OUTBOX_FAILURES'],version:3};
const base={revision:0,live:false,pending:0,syntheticOnly:true,names:{},canDecide:false,canRevise:false,canSandbox:false,canPurge:false};
async function render(props:Partial<typeof base>){
  const app=createSSRApp(Inbox,{...base,...props});app.config.warnHandler=()=>{};
  const tag=defineComponent({setup(_,{slots}){return()=>h('section',slots.default?.());}});
  for(const name of ['v-btn','v-icon','v-alert','v-table','v-dialog','v-card','v-card-title','v-card-text','v-card-actions','v-chip','v-checkbox','v-textarea','v-text-field','v-divider','v-spacer'])app.component(name,tag);
  return renderToString(app);
}
beforeEach(()=>{request.mockReset();request.mockImplementation(async(_m:string,url:string)=>url==='/learning-drafts'?{items:[]}:url==='/learning-drafts/health'?health:{});});
describe('Learning Draft inbox — controls mirror backend permissions',()=>{
  it('sandbox trigger needs edit + view_all (not just edit)',async()=>{
    expect(await render({canSandbox:false})).not.toContain('Chạy thử');
    expect(await render({canSandbox:true})).toContain('Chạy thử');
  });
  it('approver without view_all never calls the Admin-only health endpoint',async()=>{
    await render({canDecide:false});
    expect(request.mock.calls.map(c=>c[1])).toEqual(['/learning-drafts']);
    request.mockClear();
    await render({canDecide:true});
    expect(request.mock.calls.map(c=>c[1])).toEqual(expect.arrayContaining(['/learning-drafts','/learning-drafts/health']));
  });
  it('template gates every decision/revise/purge control on the matching capability',()=>{
    const src=readFileSync(new URL('../src/views/ai-quality-control/LearningDraftInbox.vue',import.meta.url),'utf8');
    expect(src).toContain(`v-if="detail.status === 'DRAFT' && canDecide"`);
    expect(src).toContain(`v-else-if="detail.status === 'CHANGES_REQUESTED' && canDecide"`);
    expect(src).toContain('v-if="canRevise"');
    expect(src).toContain(`v-if="canPurge && filter === 'DONE'"`);
    expect(src).not.toMatch(/\bcanEdit\b/);
    const dash=readFileSync(new URL('../src/views/ai-quality-control/AIQualityControlDashboard.vue',import.meta.url),'utf8');
    expect(dash).toContain(`:can-decide="can('approve')&&can('view_all')"`);
    expect(dash).toContain(`:can-purge="can('delete')&&can('view_all')"`);
  });
});
