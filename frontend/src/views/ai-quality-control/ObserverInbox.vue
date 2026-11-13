<template>
  <section v-if="items.length || error || realtimeConnected" :class="['observer-inbox', { 'is-empty': !items.length, 'has-unread': unread > 0 }]">
    <header>
      <div class="inbox-heading">
        <span class="bell-icon"><v-icon size="19">{{ items.length ? 'mdi-bell-ring-outline' : 'mdi-bell-check-outline' }}</v-icon></span>
        <div class="inbox-title">
          <h3>Thông báo cần xem xét<span v-if="unread" class="unread-badge">{{ unread }} mới</span></h3>
          <p v-if="error" class="inbox-error">{{ error }}</p>
          <p v-else-if="items.length">Nhận xét trong phạm vi được phân công và được phép truy cập.</p>
          <p v-else>Không có nội dung mới cần xem xét trong phạm vi của bạn.</p>
        </div>
      </div>
      <div class="inbox-actions">
        <span v-if="realtimeConnected" class="live-pill" title="Đã kết nối thông báo trực tiếp"><i />Trực tiếp</span>
        <v-btn icon="mdi-refresh" variant="text" size="small" density="comfortable" :loading="busy" aria-label="Làm mới thông báo" @click="load" />
      </div>
    </header>
    <button v-for="item in items.slice(0,5)" :key="item.id" class="inbox-item" @click="open(item.id)"><span :class="['unread-dot',{'is-read':!item.unread}]" /><div class="inbox-content"><strong>{{ item.employees.map(u=>u.name).join(', ') || 'Hội thoại cần xem xét' }}</strong><p>{{ item.types.map(qcLabel).join(' · ') }}</p></div><time>{{ time(item.createdAt) }}</time><v-icon size="18">mdi-chevron-right</v-icon></button>
    <v-dialog v-model="dialog" max-width="1000" scrollable><v-card><v-card-title class="d-flex align-center">Bằng chứng và nhận xét<v-spacer /><v-btn icon="mdi-close" aria-label="Đóng bằng chứng" size="small" variant="text" @click="dialog=false" /></v-card-title><v-card-text><p class="text-caption">Nhận xét của AI cần người phụ trách đối soát; chưa phải kết luận vi phạm.</p><ObservationResultCards v-if="detail" :results="[detail]" /></v-card-text></v-card></v-dialog>
  </section>
</template>
<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue';
import {qcRequest} from '@/api/ai-quality-control';
import ObservationResultCards from './ObservationResultCards.vue';
import type {ObservationResult,ObservationEmployee} from './observation-types';
import {qcError,qcLabel} from './presentation';
import {io,type Socket} from 'socket.io-client';
import {readToken} from '@/api/index';
import {useRoute,useRouter} from 'vue-router';
const props=defineProps<{revision:number}>();
const route=useRoute(),router=useRouter();
// Đến từ chuông cảnh báo toàn CRM: mở thẳng bằng chứng rồi bỏ query để F5 không mở lại.
function openFromRoute(){const id=route.query.observation;if(typeof id!=='string'||!id)return;const {observation:_,...rest}=route.query;void router.replace({query:rest});void open(id);}
watch(()=>route.query.observation,()=>openFromRoute());
type Item={id:string;createdAt:string;unread:boolean;employees:ObservationEmployee[];types:string[]};
const items=ref<Item[]>([]),unread=ref(0),busy=ref(false),error=ref(''),dialog=ref(false),detail=ref<ObservationResult|null>(null);
let timer:ReturnType<typeof setInterval>|undefined;let active=true;
let socket:Socket|undefined;const realtimeConnected=ref(false);
async function load(){if(busy.value||document.hidden)return;busy.value=true;try{const data=await qcRequest<{items:Item[];unread:number}>('get','/department-observations');if(active){items.value=data.items;unread.value=data.unread;error.value='';}}catch(e){if(active){items.value=[];unread.value=0;const r=e as {response?:{status?:number}};error.value=r.response?.status===404?'':'Không tải được thông báo. Vui lòng làm mới.';}}finally{busy.value=false;}}
async function open(id:string){busy.value=true;error.value='';try{detail.value=await qcRequest<ObservationResult>('get',`/department-observations/${id}`);dialog.value=true;await qcRequest('post',`/department-observations/${id}/seen`,{});items.value=items.value.map(i=>i.id===id?{...i,unread:false}:i);unread.value=items.value.filter(i=>i.unread).length;}catch(e){const r=e as {response?:{data?:{error?:string}}};error.value=qcError(r.response?.data?.error);detail.value=null;dialog.value=false;}finally{busy.value=false;}}
const time=(v:string)=>new Date(v).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
watch(()=>props.revision,()=>void load());
onMounted(()=>{openFromRoute();void load();timer=setInterval(()=>void load(),30000);socket=io('/aiqc-observers',{auth:cb=>cb({token:readToken()??''}),transports:['websocket'],autoConnect:false});socket.on('connect',()=>{realtimeConnected.value=true;void load();});socket.on('aiqc:observations-changed',()=>{void load();});socket.on('disconnect',()=>{realtimeConnected.value=false;});socket.connect();});
onUnmounted(()=>{active=false;if(timer)clearInterval(timer);socket?.disconnect();});
</script>
<style scoped>
.observer-inbox{margin:0 0 24px;border:1px solid var(--qc-border);border-radius:14px;background:rgb(var(--v-theme-surface));overflow:hidden}.observer-inbox.has-unread{border-color:rgba(var(--v-theme-primary),.3);box-shadow:inset 3px 0 0 rgb(var(--v-theme-primary))}.observer-inbox header{display:flex;justify-content:space-between;align-items:center;padding:14px 16px 14px 20px;gap:12px}.inbox-heading{display:flex;gap:12px;align-items:center;min-width:0}.inbox-title{min-width:0}.bell-icon{width:36px;height:36px;flex-shrink:0;background:rgba(var(--v-theme-primary),.1);color:rgb(var(--v-theme-primary));border-radius:10px;display:grid;place-items:center}.is-empty .bell-icon{background:rgba(45,153,119,.1);color:#2f8a6f}.inbox-heading h3{display:flex;align-items:center;font-size:14px;font-weight:650;line-height:1.4}.inbox-heading p{font-size:13px;color:var(--qc-muted);margin-top:2px}.unread-badge{font-size:11px;font-weight:700;background:rgb(var(--v-theme-primary));color:#fff;padding:1px 8px;border-radius:999px;margin-left:8px}.inbox-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}.live-pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#2f8a6f;padding:2px 9px;border-radius:999px;background:rgba(45,153,119,.08)}.live-pill i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:live-pulse 2s ease-in-out infinite}@keyframes live-pulse{50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.live-pill i{animation:none}}.inbox-item{display:flex;align-items:center;gap:13px;width:100%;text-align:left;border:0;border-top:1px solid rgba(127,145,175,.12);background:transparent;color:inherit;padding:14px 20px;cursor:pointer}.inbox-item:hover{background:rgba(110,137,210,.04)}.inbox-item:focus-visible{outline:2px solid #5977d5;outline-offset:-2px}.inbox-content{flex:1;min-width:0}.inbox-content strong{font-size:13px;font-weight:600}.inbox-content p{font-size:11px;color:var(--qc-muted);margin-top:4px}.inbox-item time{font-size:11px;color:var(--qc-muted);white-space:nowrap}.unread-dot{width:7px;height:7px;border-radius:50%;background:#6282e4;flex-shrink:0}.unread-dot.is-read{background:#cbd2df}.inbox-heading p.inbox-error{color:rgb(var(--v-theme-error))}@media(max-width:600px){.inbox-item time{display:none}.observer-inbox header{padding:12px 14px}.live-pill{display:none}}
</style>
