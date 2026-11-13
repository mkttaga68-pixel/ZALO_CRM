<template>
  <details class="warning-list" @toggle="toggle">
    <summary><v-icon size="18">mdi-alert-circle-outline</v-icon><span>Danh sách cảnh báo</span><v-icon size="18" class="chevron">mdi-chevron-down</v-icon></summary>
    <div v-if="expanded" class="warning-body">
      <div class="d-flex align-center flex-wrap ga-2 mb-3"><p class="text-caption">Từng lượt trong 7 ngày gần nhất. Nhấn một lượt để xem nguyên nhân và xử lý.</p><v-spacer /><v-btn size="small" variant="text" :loading="loading" :disabled="!!retrying" @click="load(false)">Làm mới danh sách</v-btn></div>
      <p v-if="budget" class="text-caption mb-3">Ngân sách hôm nay (UTC): đã giữ chỗ {{ budget.reserved.toLocaleString('vi-VN') }} / {{ budget.daily.toLocaleString('vi-VN') }} token · còn {{ budget.remaining.toLocaleString('vi-VN') }} token. Lượt tiếp theo chỉ chạy nếu còn đủ hạn mức.</p>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-3">{{ error }}</v-alert>
      <v-alert v-if="notice" type="success" variant="tonal" class="mb-3">{{ notice }}</v-alert>
      <p v-if="!loading && !error && !items.length" class="text-body-2">Chưa có cảnh báo trong phạm vi hội thoại anh được phép xem.</p>
      <details v-for="item in items" :key="item.id" class="warning-item">
        <summary><span>Lượt {{ item.id.slice(0, 8) }}</span><v-chip size="x-small" variant="tonal" :color="item.state==='DEAD'?'error':'warning'">{{ stateLabel(item.state) }}</v-chip><time>{{ time(item.createdAt) }}</time><v-icon size="18" class="chevron">mdi-chevron-down</v-icon></summary>
        <div class="item-body">
          <p><strong>Nguyên nhân:</strong> {{ reason(item.errorCode) }}</p>
          <p><strong>Số lần đã thử:</strong> {{ item.attempts }} · <strong>Cập nhật:</strong> {{ time(item.updatedAt) }}</p>
          <p>{{ guidance(item.errorCode) }}</p>
          <p class="text-caption">Lượt chưa phân tích được chưa phải kết luận vi phạm.</p>
          <v-btn v-if="item.canRetry && canRetry" class="mt-2" size="small" color="primary" variant="tonal" :loading="retrying===item.id" :disabled="loading || !!retrying || !enabled" @click="retry(item)">Thử lại lượt này</v-btn>
          <p v-if="item.canRetry && !enabled" class="text-caption">Bật AI phòng ban trước khi thử lại.</p>
        </div>
      </details>
      <v-btn v-if="nextOffset!==null" class="mt-3" size="small" variant="outlined" :loading="loading" :disabled="!!retrying" @click="load(true)">Xem thêm</v-btn>
    </div>
  </details>
</template>

<script setup lang="ts">
import {ref} from 'vue';
import {qcRequest} from '@/api/ai-quality-control';
import {qcError} from './presentation';
const props=defineProps<{departmentId:string;enabled:boolean;canRetry:boolean}>();
type Item={id:string;state:string;errorCode:string|null;attempts:number;createdAt:string;updatedAt:string;canRetry:boolean};
type Page={items:Item[];nextOffset:number|null;budget:{daily:number;reserved:number;remaining:number}};
const expanded=ref(false),loading=ref(false),loaded=ref(false),error=ref(''),notice=ref(''),retrying=ref('');
const items=ref<Item[]>([]),nextOffset=ref<number|null>(null),budget=ref<Page['budget']|null>(null);
const base=()=>`/department-monitoring/departments/${encodeURIComponent(props.departmentId)}/jobs`;
const stateLabel=(state:string)=>({DEAD:'Cần kiểm tra',RETRY:'Chờ thử lại',SKIPPED:'Đã bỏ qua',DONE:'Đã phân tích'}[state]??'Đang chờ');
const time=(value:string)=>new Date(value).toLocaleString('vi-VN');
const reason=(code:string|null)=>code?qcError(code):'Chưa có thông tin nguyên nhân.';
const guidance=(code:string|null)=>code==='AI_QC_RATE_OR_TOKEN_BUDGET_EXCEEDED'
  ? 'Chờ hạn mức tần suất được khôi phục; nếu hết ngân sách ngày, chờ ngày UTC tiếp theo hoặc điều chỉnh hạn mức trong Cài đặt sau khi xem xét.'
  : code==='OLLAMA_RESOURCE_LIMIT'?'Giải phóng RAM hoặc GPU trên máy chạy AI, rồi nhấn thử lại. Hệ thống vẫn kiểm tra tài nguyên trước khi chạy.'
  : 'Kiểm tra trạng thái AI và cấu hình phòng ban trước khi thử lại.';
async function load(append=false){
  if(loading.value)return;
  loading.value=true;error.value='';
  try{const page=await qcRequest<Page>('get',base(),{offset:append?nextOffset.value??0:0});items.value=append?[...items.value,...page.items.filter(item=>!items.value.some(old=>old.id===item.id))]:page.items;nextOffset.value=page.nextOffset;budget.value=page.budget;loaded.value=true;}
  catch(e){const r=e as {response?:{status?:number;data?:{error?:string}}};error.value=r.response?.status===404?'Danh sách chi tiết chưa sẵn sàng trên máy chủ. Cần cập nhật backend.':qcError(r.response?.data?.error);if(!append){items.value=[];budget.value=null;nextOffset.value=null;}}
  finally{loading.value=false;}
}
function toggle(event:Event){expanded.value=(event.currentTarget as HTMLDetailsElement).open;if(expanded.value&&!loaded.value)void load();}
async function retry(item:Item){
  if(retrying.value||loading.value)return;
  retrying.value=item.id;error.value='';notice.value='';
  try{await qcRequest('post',`${base()}/${encodeURIComponent(item.id)}/retry`,{expectedUpdatedAt:item.updatedAt});notice.value='Đã đưa lượt này vào hàng đợi thử lại. Kết quả chỉ xuất hiện sau khi phân tích thành công.';await load();}
  catch(e){const r=e as {response?:{data?:{error?:string}}};error.value=qcError(r.response?.data?.error);}
  finally{retrying.value='';}
}
</script>

<style scoped>
.warning-list{width:100%;border-top:1px solid var(--qc-border);margin-top:4px}.warning-list summary{display:flex;align-items:center;flex-wrap:wrap;gap:8px;cursor:pointer;list-style:none;padding:12px 0;font-size:13px;font-weight:600}.warning-list summary::-webkit-details-marker{display:none}.warning-list summary:focus-visible{outline:2px solid rgb(var(--v-theme-primary));outline-offset:2px;border-radius:4px}.chevron{margin-left:auto;transition:transform .15s}.warning-list[open]>summary .chevron,.warning-item[open]>summary .chevron{transform:rotate(180deg)}.warning-body{padding:4px 0 14px}.warning-item{border:1px solid var(--qc-border);border-radius:8px;margin-top:8px;background:rgb(var(--v-theme-surface))}.warning-item>summary{padding:12px}.warning-item time{font-size:11px;color:var(--qc-muted);font-weight:400}.item-body{padding:0 12px 12px;font-size:13px;line-height:1.6;color:var(--qc-muted)}.item-body p+p{margin-top:8px}@media(prefers-reduced-motion:reduce){.chevron{transition:none}}
</style>
