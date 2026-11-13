<template>
  <div class="ar-page">
    <aside class="ar-side">
      <div class="ar-card">
        <div class="ar-card-head"><v-icon size="18">mdi-account-search-outline</v-icon><h3>Tìm khách hàng</h3></div>
        <v-text-field v-model="query" placeholder="Tên, tên Zalo hoặc số điện thoại" prepend-inner-icon="mdi-magnify" variant="outlined" density="comfortable" hide-details clearable :loading="searching" @update:model-value="scheduleSearch" @keydown.enter="search" />
        <ul v-if="results.length" class="ar-list">
          <li v-for="c in results" :key="c.contactId"><button type="button" :class="['ar-row',{active:selectedId===c.contactId}]" @click="open(c.contactId)">
            <span class="ar-avatar">{{ initials(c.name) }}</span><span class="ar-row-text"><strong>{{ c.name }}</strong><small>{{ c.lastMessageAt ? 'Tin gần nhất ' + shortTime(c.lastMessageAt) : 'Chưa có tin nhắn' }}</small></span>
            <v-icon v-if="c.saved" size="16" class="ar-saved-icon" title="Đã lưu">mdi-bookmark</v-icon></button></li>
        </ul>
        <p v-else-if="searched && !searching" class="ar-muted">Không tìm thấy khách hàng bạn được phép xem.</p>
      </div>
      <div class="ar-card">
        <div class="ar-card-head"><v-icon size="18">mdi-bookmark-multiple-outline</v-icon><h3>Khách đã lưu</h3><span class="ar-count">{{ items.length }}</span></div>
        <ul v-if="items.length" class="ar-list">
          <li v-for="c in items" :key="c.contactId"><button type="button" :class="['ar-row',{active:selectedId===c.contactId}]" @click="open(c.contactId)">
            <span class="ar-avatar">{{ initials(c.name) }}</span><span class="ar-row-text"><strong>{{ c.name }}</strong><small>{{ c.customerMessages }} tin khách · {{ c.ourMessages }} tin mình · mở {{ shortTime(c.lastOpenedAt) }}</small></span></button></li>
        </ul>
        <p v-else-if="!loadingList" class="ar-muted">Chưa lưu khách nào. Tìm và chọn một khách hàng để lưu lại.</p>
      </div>
    </aside>

    <section class="ar-main">
      <v-alert v-if="error" type="error" variant="tonal" closable class="mb-4" @click:close="error=''">{{ error }}</v-alert>
      <div v-if="!detail && !loadingDetail" class="ar-empty"><v-icon size="40">mdi-message-text-clock-outline</v-icon><h2>Lưu trữ tin nhắn khách hàng</h2><p>Chọn một khách hàng để lưu lại và xem toàn bộ tin nhắn khách đã trao đổi với chúng ta, kèm thống kê. Tin nhắn được đọc từ dữ liệu CRM theo đúng quyền xem của bạn.</p></div>
      <v-skeleton-loader v-if="loadingDetail && !detail" type="heading, card, card, paragraph" />
      <template v-if="detail">
        <header class="ar-head">
          <span class="ar-avatar lg">{{ initials(detail.customer.name) }}</span>
          <div class="ar-head-text"><h2>{{ detail.customer.name }}</h2><p>{{ detail.customer.conversations }} hội thoại Zalo<span v-if="detail.archive"> · Đã lưu {{ fullTime(detail.archive.savedAt) }} · mở {{ detail.archive.openCount }} lần</span></p></div>
          <div class="ar-head-actions"><v-btn variant="outlined" prepend-icon="mdi-refresh" :loading="loadingDetail" @click="open(detail.customer.contactId)">Làm mới</v-btn><v-btn v-if="canRemove" variant="text" color="error" prepend-icon="mdi-bookmark-remove-outline" @click="remove">Bỏ lưu</v-btn></div>
        </header>

        <div class="ar-tiles">
          <div class="ar-tile"><small>Tổng tin nhắn</small><strong>{{ num(stats.total) }}</strong><span>{{ stats.firstAt ? 'Từ ' + day(stats.firstAt) : '—' }}</span></div>
          <div class="ar-tile"><small>Khách nhắn</small><strong class="c-customer">{{ num(stats.customer) }}</strong><span>{{ percent(stats.customer, stats.total) }} tổng số tin</span></div>
          <div class="ar-tile"><small>Chúng ta nhắn</small><strong>{{ num(stats.ours) }}</strong><span>{{ stats.automation ? num(stats.automation) + ' tin tự động' : 'Không có tin tự động' }}</span></div>
          <div class="ar-tile"><small>Ngày khách nhắn</small><strong>{{ num(stats.activeDays) }}</strong><span>{{ stats.lastCustomerAt ? 'Gần nhất ' + day(stats.lastCustomerAt) : 'Khách chưa nhắn' }}</span></div>
          <div class="ar-tile"><small>Phản hồi trung vị</small><strong>{{ duration(stats.reply.medianSeconds) }}</strong><span>{{ stats.reply.count ? percent(stats.reply.within5Minutes, stats.reply.count) + ' trong 5 phút' : 'Chưa có lượt phản hồi' }}</span></div>
          <div class="ar-tile"><small>Lượt chưa trả lời</small><strong :class="{'c-warn':stats.reply.unanswered>0}">{{ num(stats.reply.unanswered) }}</strong><span>Khách nhắn cuối chưa được trả lời</span></div>
        </div>
        <p v-if="stats.truncated" class="ar-muted mb-3">Khách có rất nhiều tin; thống kê tính trên 50.000 tin gần nhất.</p>

        <div class="ar-grid">
          <div class="ar-card">
            <div class="ar-card-head"><h3>Tin nhắn 12 tháng gần nhất</h3><span class="ar-legend"><i class="dot customer" />Khách<i class="dot ours" />Chúng ta</span></div>
            <div class="ar-bars" role="img" :aria-label="`Số tin theo tháng: ${stats.byMonth.map(m=>`${monthLabel(m.month)} khách ${m.customer}, chúng ta ${m.ours}`).join('; ')}`">
              <div v-for="m in stats.byMonth" :key="m.month" class="ar-bar-col" :title="`${monthLabel(m.month)}: khách ${m.customer}, chúng ta ${m.ours}`">
                <div class="ar-bar-stack"><span class="bar ours" :style="{height:pct(m.ours,monthMax)}" /><span class="bar customer" :style="{height:pct(m.customer,monthMax)}" /></div><small>{{ monthLabel(m.month, true) }}</small></div>
            </div>
          </div>
          <div class="ar-card">
            <div class="ar-card-head"><h3>Khách hay nhắn lúc mấy giờ</h3><span class="ar-legend">Giờ Việt Nam</span></div>
            <div class="ar-bars hours" role="img" :aria-label="`Tin của khách theo giờ: ${stats.byHour.map((n,h)=>`${h} giờ: ${n}`).join(', ')}`">
              <div v-for="(n,h) in stats.byHour" :key="h" class="ar-bar-col" :title="`${h}:00–${h}:59: ${n} tin`"><div class="ar-bar-stack"><span class="bar customer" :style="{height:pct(n,hourMax)}" /></div><small>{{ h % 3 === 0 ? h : '' }}</small></div>
            </div>
          </div>
          <div class="ar-card">
            <div class="ar-card-head"><h3>Loại tin khách gửi</h3></div>
            <ul class="ar-meter">
              <li v-for="t in types" :key="t.type"><span>{{ typeLabel(t.type) }}</span><div class="track"><i :style="{width:pct(t.count,stats.customer)}" /></div><strong>{{ num(t.count) }}</strong></li>
              <li v-if="!types.length" class="ar-muted">Khách chưa gửi tin nào.</li>
            </ul>
          </div>
          <div class="ar-card">
            <div class="ar-card-head"><h3>Theo tài khoản Zalo</h3></div>
            <ul class="ar-meter">
              <li v-for="a in stats.byAccount" :key="a.account"><span>{{ a.account }}</span><div class="track"><i :style="{width:pct(a.customer+a.ours,stats.total)}" /></div><strong>{{ num(a.customer) }} / {{ num(a.ours) }}</strong></li>
            </ul>
            <p class="ar-muted">Số tin: khách / chúng ta.</p>
          </div>
        </div>

        <div class="ar-card ar-thread">
          <div class="ar-card-head"><v-icon size="18">mdi-forum-outline</v-icon><h3>Tin nhắn</h3><v-btn-toggle v-model="filter" density="compact" variant="outlined" divided mandatory class="ml-auto"><v-btn value="all" size="small">Tất cả</v-btn><v-btn value="CUSTOMER" size="small">Khách</v-btn><v-btn value="US" size="small">Chúng ta</v-btn></v-btn-toggle></div>
          <div class="ar-more"><v-btn v-if="detail.hasMore" variant="text" size="small" prepend-icon="mdi-history" :loading="loadingOlder" @click="older">Tải tin cũ hơn</v-btn><span v-else class="ar-muted">Đã hiển thị từ tin đầu tiên.</span></div>
          <template v-for="(m,i) in shown" :key="m.id">
            <div v-if="i===0 || day(m.at)!==day(shown[i-1]!.at)" class="ar-day"><span>{{ day(m.at) }}</span></div>
            <div :class="['ar-msg', m.from==='CUSTOMER'?'in':'out']">
              <div class="ar-bubble"><span v-if="m.type!=='text'" class="ar-type"><v-icon size="14">{{ typeIcon(m.type) }}</v-icon>{{ typeLabel(m.type) }}</span><span v-if="m.text" class="ar-text">{{ m.text }}</span><span v-else-if="m.type==='text'" class="ar-muted">(trống)</span></div>
              <small>{{ clock(m.at) }}<template v-if="m.from==='US'"> · {{ m.via==='automation' ? 'Tự động' : (m.sender || 'Nhân viên') }}</template><template v-if="detail.customer.conversations>1 && m.account"> · {{ m.account }}</template></small>
            </div>
          </template>
          <p v-if="!shown.length" class="ar-muted ar-pad">Không có tin nhắn phù hợp.</p>
        </div>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import {computed,onMounted,ref} from 'vue';
import {qcRequest,type ArchiveCustomer,type ArchiveDetail,type ArchiveItem,type ArchiveMessage} from '@/api/ai-quality-control';
import {qcError} from './presentation';
const props=defineProps<{canApprove:boolean}>();
const query=ref(''),results=ref<ArchiveCustomer[]>([]),items=ref<ArchiveItem[]>([]),detail=ref<ArchiveDetail|null>(null),selectedId=ref<string|null>(null);
const searching=ref(false),searched=ref(false),loadingList=ref(false),loadingDetail=ref(false),loadingOlder=ref(false),error=ref(''),filter=ref<'all'|'CUSTOMER'|'US'>('all');
const ERRORS:Record<string,string>={AI_QC_REAL_DATA_DISABLED:'Chưa bật đọc dữ liệu CRM thật cho phân hệ này. Vui lòng liên hệ quản trị viên.',AI_QC_REAL_DATA_TENANT_NOT_APPROVED:'Tổ chức của bạn chưa được duyệt đọc dữ liệu CRM thật trong phân hệ này.',CUSTOMER_NOT_FOUND:'Không tìm thấy khách hàng hoặc bạn không có quyền xem hội thoại của khách này.',FORBIDDEN:'Chỉ người đã lưu hoặc người có quyền duyệt mới bỏ lưu được.'};
const message=(e:unknown)=>{const r=e as {response?:{status?:number;data?:{error?:string}}};const code=r.response?.data?.error;return r.response?.status===404&&!code?'Tính năng chưa sẵn sàng trên máy chủ hiện tại.':ERRORS[code??'']??qcError(code);};
const stats=computed(()=>detail.value!.stats);
const monthMax=computed(()=>Math.max(1,...stats.value.byMonth.map(m=>m.customer+m.ours)));
const hourMax=computed(()=>Math.max(1,...stats.value.byHour));
const types=computed(()=>Object.entries(stats.value.byType).map(([type,count])=>({type,count})).sort((a,b)=>b.count-a.count));
const shown=computed<ArchiveMessage[]>(()=>(detail.value?.messages??[]).filter(m=>filter.value==='all'||m.from===filter.value));
const canRemove=computed(()=>!!detail.value?.archive&&(props.canApprove||items.value.some(i=>i.contactId===detail.value?.customer.contactId&&i.savedByMe)));
const num=(n:number)=>n.toLocaleString('vi-VN'),pct=(n:number,max:number)=>`${max?Math.round(n/max*1000)/10:0}%`,percent=(n:number,t:number)=>t?`${Math.round(n/t*100)}%`:'0%';
const vn=(iso:string,o:Intl.DateTimeFormatOptions)=>new Date(iso).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',...o});
const day=(iso:string)=>vn(iso,{day:'2-digit',month:'2-digit',year:'numeric'}),clock=(iso:string)=>vn(iso,{hour:'2-digit',minute:'2-digit'}),fullTime=(iso:string)=>vn(iso,{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const shortTime=(iso:string)=>{const d=Date.now()-Date.parse(iso);return d<86400000&&d>=0?clock(iso):day(iso);};
const monthLabel=(m:string,short=false)=>{const [y,mo]=m.split('-');return short?`T${Number(mo)}`:`Tháng ${Number(mo)}/${y}`;};
const duration=(s:number|null)=>s===null?'—':s<60?`${s} giây`:s<3600?`${Math.round(s/60)} phút`:s<86400?`${Math.round(s/360)/10} giờ`:`${Math.round(s/8640)/10} ngày`;
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).slice(-2).map(w=>w[0]!.toUpperCase()).join('')||'?';
const TYPES:Record<string,[string,string]>={text:['Văn bản','mdi-text'],image:['Hình ảnh','mdi-image-outline'],file:['Tệp','mdi-paperclip'],sticker:['Sticker','mdi-sticker-emoji'],voice:['Ghi âm','mdi-microphone-outline'],video:['Video','mdi-video-outline'],link:['Liên kết','mdi-link-variant'],gif:['GIF','mdi-file-gif-box'],location:['Vị trí','mdi-map-marker-outline'],contact:['Danh thiếp','mdi-card-account-details-outline']};
const typeLabel=(t:string)=>TYPES[t]?.[0]??t,typeIcon=(t:string)=>TYPES[t]?.[1]??'mdi-message-outline';
async function loadList(){loadingList.value=true;try{items.value=(await qcRequest<{items:ArchiveItem[]}>('get','/customer-archive')).items;}catch(e){error.value=message(e);}finally{loadingList.value=false;}}
let timer:ReturnType<typeof setTimeout>|undefined;
function scheduleSearch(){clearTimeout(timer);timer=setTimeout(search,350);}
async function search(){clearTimeout(timer);searching.value=true;try{results.value=(await qcRequest<{customers:ArchiveCustomer[]}>('get','/customer-archive/search',{q:query.value??''})).customers;searched.value=true;}catch(e){error.value=message(e);}finally{searching.value=false;}}
async function open(id:string){selectedId.value=id;loadingDetail.value=true;error.value='';try{detail.value=await qcRequest<ArchiveDetail>('post',`/customer-archive/${id}`,{});filter.value='all';const r=results.value.find(c=>c.contactId===id);if(r)r.saved=true;await loadList();}catch(e){error.value=message(e);if(detail.value?.customer.contactId!==id)detail.value=null;}finally{loadingDetail.value=false;}}
async function older(){const d=detail.value;if(!d?.messages.length)return;loadingOlder.value=true;try{const r=await qcRequest<{messages:ArchiveMessage[];hasMore:boolean}>('get',`/customer-archive/${d.customer.contactId}`,{before:d.messages[0]!.at});const known=new Set(d.messages.map(m=>m.id));d.messages=[...r.messages.filter(m=>!known.has(m.id)),...d.messages];d.hasMore=r.hasMore;}catch(e){error.value=message(e);}finally{loadingOlder.value=false;}}
async function remove(){const d=detail.value;if(!d)return;try{await qcRequest('delete',`/customer-archive/${d.customer.contactId}`);d.archive=null;const r=results.value.find(c=>c.contactId===d.customer.contactId);if(r)r.saved=false;await loadList();}catch(e){error.value=message(e);}}
onMounted(()=>Promise.all([loadList(),search()]));
</script>

<style scoped>
.ar-page{--ar-muted:#6b7689;--ar-border:rgba(127,145,175,.2);--ar-customer:rgb(var(--v-theme-primary));--ar-ours:rgba(127,145,175,.55);display:grid;grid-template-columns:320px minmax(0,1fr);gap:20px;align-items:start}
.ar-side{display:flex;flex-direction:column;gap:16px;position:sticky;top:12px}
.ar-card{border:1px solid var(--ar-border);border-radius:14px;background:rgb(var(--v-theme-surface));padding:16px}
.ar-card-head{display:flex;align-items:center;gap:8px;margin-bottom:12px;color:rgb(var(--v-theme-on-surface))}.ar-card-head h3{font-size:14px;font-weight:650;margin:0}
.ar-count{margin-left:auto;font-size:12px;color:var(--ar-muted)}
.ar-list{list-style:none;padding:0;margin:10px 0 0;max-height:360px;overflow:auto}
.ar-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer;color:inherit}
.ar-row:hover{background:rgba(127,145,175,.08)}.ar-row.active{background:rgba(var(--v-theme-primary),.1)}.ar-row:focus-visible{outline:2px solid rgb(var(--v-theme-primary));outline-offset:1px}
.ar-row-text{display:flex;flex-direction:column;min-width:0;flex:1}.ar-row-text strong{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ar-row-text small{font-size:11px;color:var(--ar-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ar-saved-icon{color:rgb(var(--v-theme-primary))}
.ar-avatar{width:34px;height:34px;flex-shrink:0;display:grid;place-items:center;border-radius:50%;background:rgba(var(--v-theme-primary),.12);color:rgb(var(--v-theme-primary));font-size:12px;font-weight:700}.ar-avatar.lg{width:52px;height:52px;font-size:17px}
.ar-muted{font-size:12px;color:var(--ar-muted);margin:8px 0 0}
.ar-main{min-width:0}
.ar-empty{padding:70px 24px;text-align:center;color:var(--ar-muted);border:1px dashed var(--ar-border);border-radius:14px;background:rgb(var(--v-theme-surface))}.ar-empty h2{font-size:18px;margin:12px 0 6px;color:rgb(var(--v-theme-on-surface))}.ar-empty p{max-width:520px;margin:0 auto;font-size:13px;line-height:1.6}
.ar-head{display:flex;align-items:center;gap:14px;margin-bottom:16px}.ar-head-text{min-width:0;flex:1}.ar-head-text h2{font-size:20px;font-weight:700;margin:0}.ar-head-text p{font-size:13px;color:var(--ar-muted);margin:2px 0 0}.ar-head-actions{display:flex;gap:8px;flex-wrap:wrap}
.ar-tiles{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:16px}
.ar-tile{border:1px solid var(--ar-border);border-radius:12px;background:rgb(var(--v-theme-surface));padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.ar-tile small{font-size:11px;color:var(--ar-muted)}.ar-tile strong{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums}.ar-tile span{font-size:11px;color:var(--ar-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.c-customer{color:var(--ar-customer)}.c-warn{color:rgb(var(--v-theme-warning))}
.ar-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:16px}
.ar-legend{margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ar-muted)}.dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-left:6px}.dot.customer{background:var(--ar-customer)}.dot.ours{background:var(--ar-ours)}
.ar-bars{display:flex;align-items:flex-end;gap:6px;height:150px;padding-top:6px}.ar-bars.hours{gap:2px}
.ar-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;min-width:0}.ar-bar-col small{font-size:10px;color:var(--ar-muted);height:12px}
.ar-bar-stack{flex:1;width:100%;display:flex;flex-direction:column-reverse;justify-content:flex-start;border-radius:4px;background:rgba(127,145,175,.06);overflow:hidden}
.bar{display:block;width:100%}.bar.customer{background:var(--ar-customer)}.bar.ours{background:var(--ar-ours)}
.ar-meter{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}.ar-meter li{display:grid;grid-template-columns:110px minmax(0,1fr) auto;align-items:center;gap:10px;font-size:12px}.ar-meter li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ar-meter strong{font-variant-numeric:tabular-nums;font-weight:600}
.track{height:8px;border-radius:999px;background:rgba(127,145,175,.12);overflow:hidden}.track i{display:block;height:100%;border-radius:999px;background:var(--ar-customer)}
.ar-thread{padding-bottom:20px}.ar-more{text-align:center;margin-bottom:8px}
.ar-day{display:flex;justify-content:center;margin:14px 0 8px}.ar-day span{font-size:11px;color:var(--ar-muted);background:rgba(127,145,175,.1);padding:2px 10px;border-radius:999px}
.ar-msg{display:flex;flex-direction:column;max-width:72%;margin:4px 0}.ar-msg.in{align-items:flex-start}.ar-msg.out{align-items:flex-end;margin-left:auto}
.ar-bubble{padding:8px 12px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;display:flex;flex-direction:column;gap:4px}
.in .ar-bubble{background:rgba(127,145,175,.1);border-top-left-radius:4px}.out .ar-bubble{background:rgba(var(--v-theme-primary),.12);border-top-right-radius:4px}
.ar-type{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--ar-muted)}
.ar-msg small{font-size:10px;color:var(--ar-muted);margin-top:2px;padding:0 4px}.ar-pad{text-align:center;padding:20px 0}
@media(max-width:1280px){.ar-tiles{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:1000px){.ar-page{grid-template-columns:1fr}.ar-side{position:static}.ar-grid{grid-template-columns:1fr}}
@media(max-width:650px){.ar-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.ar-head{flex-wrap:wrap}.ar-msg{max-width:90%}.ar-meter li{grid-template-columns:80px minmax(0,1fr) auto}}
</style>
