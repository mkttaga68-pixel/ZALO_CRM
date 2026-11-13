<template>
  <v-card variant="outlined" class="pa-5">
    <div class="d-flex align-center justify-space-between flex-wrap ga-3">
      <div><h2>Giám sát theo phòng ban</h2><p>Thiết lập phạm vi phân tích và người nhận cảnh báo.</p></div>
      <div class="d-flex ga-2"><v-btn v-if="state?.killSwitchActive" color="primary" variant="tonal" :disabled="busy" @click="resume">Mở lại quét thử</v-btn><v-btn color="error" variant="outlined" :disabled="busy || !state" @click="stopDialog=true">Dừng tất cả</v-btn></div>
    </div>

    <div v-if="state" class="department-status"><v-chip size="small" variant="tonal" :color="state.killSwitchActive ? 'warning' : 'primary'">{{ state.killSwitchActive ? 'Đang tạm dừng toàn bộ' : state.automatic ? 'Theo dõi liên tục' : 'Quét theo yêu cầu' }}</v-chip><span>AI cục bộ · {{ state.automatic ? 'Thông báo trực tiếp cho người phụ trách' : 'Xem trước trước khi gửi' }}</span></div>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" class="mb-4">{{ notice }}</v-alert>

    <v-select v-model="departmentId" :items="state?.departments ?? []" item-title="name" item-value="id" label="Phòng ban" :loading="busy" :disabled="scanning" @update:model-value="selectDepartment" />
    <template v-if="selected">
      <p class="text-body-2 mb-3">{{ selected.memberCount }} thành viên · {{ selected.enabled ? 'Đang bật' : 'Đang tắt' }}</p>
      <div class="ai-toggle-panel"><div><h3>AI phân tích phòng ban</h3><p>{{ state?.automatic ? selected.enabled && selected.continuousEnabled ? 'Đang tự quét tin nhắn mới của tất cả nhân viên trong phòng ban.' : 'Bật để tự quét tin nhắn phát sinh từ thời điểm bật và thông báo trực tiếp cho người phụ trách.' : selected.enabled ? 'Đã cho phép quét theo yêu cầu cho phòng ban này.' : 'Bật để cho phép AI phân tích các hội thoại thuộc phòng ban.' }}</p></div><v-switch :model-value="selected.enabled" color="primary" hide-details inset :label="selected.enabled ? 'Đang bật' : 'Đang tắt'" :loading="busy" :disabled="busy || !canEdit || (!selected.enabled && (selected.version==='0' || !!selected.blockers.length || !!state?.killSwitchActive || dirty))" @update:model-value="toggleAi" /></div>
      <div class="schedule-panel">
        <div class="schedule-head">
          <div><h3><v-icon size="18" class="mr-1">mdi-clock-outline</v-icon>Lịch tự động bật/tắt (Timeset)</h3>
            <p>{{ scheduleSummary }}</p></div>
          <v-switch v-model="schedule.enabled" color="primary" hide-details inset :label="schedule.enabled ? 'Chạy theo lịch' : 'Chạy cả ngày'" :disabled="busy || !canEdit" />
        </div>
        <template v-if="schedule.enabled">
          <span class="schedule-label">Ngày trong tuần</span>
          <v-chip-group v-model="schedule.days" multiple column selected-class="text-primary"><v-chip v-for="d in weekDays" :key="d.value" :value="d.value" filter variant="outlined" size="small" :disabled="busy || !canEdit">{{ d.title }}</v-chip></v-chip-group>
          <div class="d-flex ga-2 flex-wrap"><v-btn size="x-small" variant="text" :disabled="busy || !canEdit" @click="schedule.days=[1,2,3,4,5]">Thứ 2 – Thứ 6</v-btn><v-btn size="x-small" variant="text" :disabled="busy || !canEdit" @click="schedule.days=[1,2,3,4,5,6]">Thứ 2 – Thứ 7</v-btn><v-btn size="x-small" variant="text" :disabled="busy || !canEdit" @click="schedule.days=[0,1,2,3,4,5,6]">Cả tuần</v-btn></div>
          <span class="schedule-label">Khung giờ AI bật (giờ Việt Nam, GMT+7)</span>
          <div v-for="(w, i) in schedule.windows" :key="i" class="schedule-window">
            <v-text-field v-model="w.start" type="time" label="Bật lúc" density="compact" hide-details :disabled="busy || !canEdit" />
            <span>→</span>
            <v-text-field v-model="w.end" type="time" label="Tắt lúc" density="compact" hide-details :disabled="busy || !canEdit" />
            <v-btn icon="mdi-delete-outline" size="small" variant="text" aria-label="Xoá khung giờ" :disabled="busy || !canEdit || schedule.windows.length<=1" @click="schedule.windows.splice(i,1)" />
          </div>
          <p v-if="schedule.windows.some(w=>w.start && w.end && w.start>w.end)" class="text-caption mb-1">Khung có giờ tắt sớm hơn giờ bật được hiểu là ca qua đêm (tắt vào sáng hôm sau).</p>
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" :disabled="busy || !canEdit || schedule.windows.length>=4" @click="schedule.windows.push({start:'13:30',end:'17:30'})">Thêm khung giờ</v-btn>
        </template>
        <div class="d-flex align-center ga-3 flex-wrap mt-3">
          <v-btn color="primary" variant="tonal" size="small" :loading="busy" :disabled="busy || !canEdit || !scheduleDirty" @click="saveSchedule">Lưu lịch</v-btn>
          <v-chip v-if="selected.enabled && selected.schedule.enabled" size="small" variant="tonal" :color="selected.scheduleActive ? 'success' : 'secondary'">{{ selected.scheduleActive ? 'Đang trong giờ hoạt động' : 'Ngoài giờ — AI tạm nghỉ' }}</v-chip>
          <span v-if="selected.enabled && selected.schedule.enabled && selected.scheduleNextChangeAt" class="text-caption">{{ selected.scheduleActive ? 'Tự tắt' : 'Tự bật' }} lúc {{ formatChange(selected.scheduleNextChangeAt) }}</span>
          <span v-if="!selected.enabled && selected.schedule.enabled" class="text-caption">Lịch chỉ có hiệu lực khi công tắc AI phòng ban ở trên đang bật.</span>
          <span v-if="scheduleDirty" class="text-caption text-warning">Lịch có thay đổi chưa lưu.</span>
        </div>
      </div>
      <div v-if="state?.automatic" class="continuous-status"><v-chip v-for="job in selected.jobs" :key="job.state" size="small" variant="tonal" :color="job.state==='DONE'?'success':job.state==='DEAD'?'error':'secondary'">{{ jobState(job.state) }}: {{ job.count }}</v-chip><p v-if="!selected.jobs.length" class="text-caption">Chưa có tin nhắn mới được xếp hàng. Tin trước lúc bật không tự quét lại.</p><p class="text-caption mt-2">Hàng đợi thử lại có giới hạn. Mở danh sách bên dưới để xem đúng nguyên nhân của từng lượt chưa xử lý được.</p>
      <DepartmentJobWarnings :key="selected.id" :department-id="selected.id" :enabled="selected.enabled && selected.continuousEnabled && !state.killSwitchActive" :can-retry="canEdit" />
      </div>
      <v-alert v-if="selected.blockers.length && !selected.enabled" type="info" variant="tonal" class="mb-4"><div class="text-body-2 font-weight-medium">Cần hoàn tất trước khi bật AI</div><ul class="pl-4 mt-1"><li v-for="blocker in selected.blockers" :key="blocker">{{ blocker.startsWith('APPROVED_DEPARTMENT_RULES_MISSING:') ? 'Thiếu quy tắc đã duyệt: '+qcLabel(blocker.split(':')[1]) : qcError(blocker) }}</li></ul></v-alert>
      <v-select v-model="draft.analysisTypes" :items="analysisOptions" label="Nội dung cần kiểm tra" multiple chips />
      <v-select v-model="draft.recipientUserIds" :items="state?.users ?? []" item-title="name" item-value="id" label="Người phụ trách xem xét" multiple chips />
      <v-text-field v-model.number="draft.lookbackHours" type="number" min="1" max="72" label="Khoảng thời gian xem xét (giờ, tối đa 72)" />
      <v-text-field v-model.number="draft.maxConversationsPerRun" type="number" min="1" max="500" label="Giới hạn hội thoại mỗi lượt (tối đa 500)" />
      <v-text-field v-model="draft.approvalRef" label="Mã tài liệu phê duyệt" hint="Mã tham chiếu đến tài liệu đã được duyệt." />
      <div class="d-flex ga-2 flex-wrap">
        <v-btn :loading="busy" :disabled="busy || scanning || !canEdit" @click="save">Lưu cấu hình</v-btn>
        <v-btn variant="outlined" :loading="busy" :disabled="busy || scanning || !selected.enabled || !canEdit || dirty || state?.killSwitchActive" @click="previewScan">Xem trước quét thử</v-btn>
      </div>
      <p class="text-caption mt-3">Tối đa 5 hội thoại mỗi lượt. Đổi cấu hình sẽ tắt AI để anh kiểm tra và bật lại. Lượt đã gửi tới AI có thể hoàn tất sau khi tắt.</p>
      <p v-if="dirty" class="text-caption text-warning mt-2">Có thay đổi chưa lưu. Hãy lưu cấu hình trước khi bật AI.</p>
      <p v-if="selected.updatedAt" class="text-caption">Cập nhật: {{ new Date(selected.updatedAt).toLocaleString('vi-VN') }}</p>

      <v-card v-if="scanPreview" variant="tonal" class="pa-4 mt-4">
        <h3>Xem trước · {{ scanPreview.department.name }} · {{ scanPreview.count }} hội thoại</h3>
        <p>Trong {{ scanPreview.lookbackHours }} giờ gần nhất, từ tối đa 50 hội thoại mới nhất bạn được phép xem.</p>
        <v-expansion-panels multiple class="my-3">
          <v-expansion-panel v-for="item in scanPreview.candidates" :key="item.conversationId" :title="`${item.employees?.map(u=>u.name).join(', ') || 'Chưa xác định nhân viên'} · ${item.title || 'Hội thoại'} · ${item.canAnalyze ? 'Sẵn sàng' : 'Chưa đủ điều kiện'}`">
            <v-expansion-panel-text>
              <v-alert v-if="item.blockers.length" type="warning" variant="tonal"><ul><li v-for="b in item.blockers" :key="b">{{ qcError(b) }}</li></ul></v-alert>
              <div v-for="m in item.messages" :key="m.id" class="qc-message"><strong>{{ m.id }} · {{ qcLabel(m.role) }}</strong><p>{{ m.text }}</p></div>
              <div v-for="rule in item.rules" :key="rule.id"><strong>{{ qcLabel(rule.type) }} · {{ rule.id }} · phiên bản {{ rule.revision }}</strong><blockquote>{{ rule.quote }}</blockquote></div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <v-checkbox v-model="confirmedBatch" label="Tôi đã xem toàn bộ bản xem trước và xác nhận gửi đúng các hội thoại này tới Ollama chạy cục bộ để phân tích." :disabled="busy || !allReady" />
        <v-btn color="primary" :loading="scanning" :disabled="busy || scanning || !selected.enabled || !confirmedBatch || !allReady" @click="runScan">Chạy quét thử một lượt</v-btn>
      </v-card>
      <div v-if="scanResult" class="mt-6"><div class="d-flex justify-space-between align-center flex-wrap ga-2"><div><h3>Kết quả phân tích</h3><p class="text-caption mt-2">{{ scanResult.processed }} / {{ scanResult.results.length }} hội thoại đã phân tích · {{ scanResult.results.filter(r=>r.error).length }} chưa xử lý được</p></div><v-chip color="primary" variant="tonal">{{ scanResult.results.filter(r=>r.findings?.some(f=>f.status==='POTENTIAL_ISSUE')).length }} hội thoại cần xem xét</v-chip></div><ObservationResultCards :results="scanResult.results" /></div>
    </template>
    <p v-else-if="!busy && !error" class="qc-empty">Chưa có phòng ban đang hoạt động.</p>

    <v-dialog v-model="stopDialog" max-width="520">
      <v-card><v-card-title>Dừng giám sát tự động</v-card-title><v-card-text>
        <p>Tạm dừng quét thử cho tổ chức. Thao tác được lưu vào lịch sử quản trị.</p>
        <v-textarea v-model="stopReason" label="Lý do (bắt buộc)" />
      </v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="stopDialog=false">Hủy</v-btn><v-btn color="error" :disabled="busy || !stopReason.trim()" @click="stop">Xác nhận dừng</v-btn></v-card-actions></v-card>
    </v-dialog>
  </v-card>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { qcRequest } from '@/api/ai-quality-control';
import { analysisOptions, qcError, qcLabel } from './presentation';
import ObservationResultCards from './ObservationResultCards.vue';
import DepartmentJobWarnings from './DepartmentJobWarnings.vue';
import type {ObservationResult} from './observation-types';
const emit=defineEmits<{refresh:[]}>();

type Schedule = { enabled:boolean; days:number[]; windows:Array<{start:string;end:string}>; timezone?:string };
type DepartmentConfig = { schedule:Schedule; scheduleActive:boolean; scheduleNextChangeAt:string|null; id: string; name: string; parentId: string | null; memberCount: number; enabled: boolean; continuousEnabled:boolean; jobs:Array<{state:string;count:number;error_code:string|null}>;version:string; blockers:string[]; analysisTypes: string[]; recipientUserIds: string[]; lookbackHours: number; maxConversationsPerRun: number; approvalRef: string; updatedAt: string | null };
type State = { enabled: boolean; runtimeAvailable: boolean; automatic:boolean;killSwitchActive: boolean; users: Array<{id:string;name:string}>; departments: DepartmentConfig[] };
type ScanPreview = { department:{id:string;name:string}; count:number; maximum:number; coverage:string; lookbackHours:number; analysisTypes:string[]; notice:string; candidates:Array<{conversationId:string;title:string;employees:Array<{id:string;name:string}>;previewToken:string;expiresAt:string;canAnalyze:boolean;blockers:string[];messages:Array<{id:string;role:string;text:string}>;rules:Array<{id:string;type:string;revision:number;quote:string}>}> };
type ScanResult = { processed:number; notice:string; results:ObservationResult[] };
const props = defineProps<{ canEdit: boolean }>();
const canEdit = computed(() => props.canEdit);
const state = ref<State | null>(null), departmentId = ref(''), busy = ref(false), error = ref(''), notice = ref(''), stopDialog = ref(false), stopReason = ref('');
const draft = reactive({ analysisTypes: [] as string[], recipientUserIds: [] as string[], lookbackHours: 24, maxConversationsPerRun: 100, approvalRef: '' });
const scanPreview = ref<ScanPreview|null>(null), scanResult = ref<ScanResult|null>(null), confirmedBatch = ref(false);
const scanning=ref(false);
const schedule = reactive<Schedule>({ enabled:false, days:[1,2,3,4,5], windows:[{start:'08:00',end:'17:30'}] });
const weekDays=[{value:1,title:'T2'},{value:2,title:'T3'},{value:3,title:'T4'},{value:4,title:'T5'},{value:5,title:'T6'},{value:6,title:'T7'},{value:0,title:'CN'}];
const scheduleKey=(s:Schedule)=>JSON.stringify({e:s.enabled,d:[...s.days].sort(),w:s.windows.map(w=>[w.start,w.end])});
const scheduleDirty=computed(()=>!!selected.value&&scheduleKey(selected.value.schedule)!==scheduleKey(schedule));
const scheduleSummary=computed(()=>{
  if(!schedule.enabled)return 'Không đặt lịch: khi công tắc AI bật, AI quét tin nhắn mới mọi lúc.';
  const days=weekDays.filter(d=>schedule.days.includes(d.value)).map(d=>d.title).join(', ')||'chưa chọn ngày';
  return `AI chỉ quét tin nhắn phát sinh trong ${schedule.windows.map(w=>`${w.start}–${w.end}`).join(', ')} vào ${days}. Ngoài giờ AI tự tắt và tự bật lại khi tới giờ.`;
});
const formatChange=(v:string)=>new Date(v).toLocaleString('vi-VN',{weekday:'short',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',timeZone:'Asia/Ho_Chi_Minh'});
async function saveSchedule(){
  if(!selected.value||busy.value)return;busy.value=true;error.value='';notice.value='';
  try{await qcRequest('put',`/department-monitoring/departments/${selected.value.id}/schedule`,{enabled:schedule.enabled,days:[...schedule.days],windows:schedule.windows.map(w=>({start:w.start,end:w.end}))});await load();notice.value=schedule.enabled?'Đã lưu lịch. AI sẽ tự bật/tắt theo khung giờ đã đặt.':'Đã tắt lịch. AI quét mọi lúc khi công tắc phòng ban đang bật.';}
  catch(e){error.value=errorMessage(e,'Không lưu được lịch.');}finally{busy.value=false;}
}
const allReady = computed(() => !!scanPreview.value?.candidates.length && scanPreview.value.candidates.every(item => item.canAnalyze));
const selected = computed(() => state.value?.departments.find(d => d.id === departmentId.value));
const dirty = computed(()=>{const d=selected.value;return !!d && (JSON.stringify(d.analysisTypes)!==JSON.stringify(draft.analysisTypes)||JSON.stringify(d.recipientUserIds)!==JSON.stringify(draft.recipientUserIds)||d.lookbackHours!==draft.lookbackHours||d.maxConversationsPerRun!==draft.maxConversationsPerRun||d.approvalRef!==draft.approvalRef);});
function errorMessage(e: unknown, fallback: string) {
  const r = e as {response?:{status?:number;data?:{error?:string}}};
  if (r.response?.status === 404) return 'Tính năng phòng ban chưa sẵn sàng trên máy chủ hiện tại.';
  if (r.response?.data?.error?.startsWith('APPROVED_DEPARTMENT_RULES_MISSING:')) return 'Chưa có đủ quy tắc đã duyệt còn hiệu lực cho phòng ban.';
  return r.response?.data?.error ? qcError(r.response.data.error) : fallback;
}
async function load() {
  busy.value = true; error.value = '';
  try { state.value = await qcRequest<State>('get', '/department-monitoring'); if (!departmentId.value) departmentId.value = state.value.departments[0]?.id ?? ''; selectDepartment(); }
  catch (e: unknown) { error.value = errorMessage(e, 'Không tải được cấu hình phòng ban.'); }
  finally { busy.value = false; }
}
function selectDepartment() {
  const d = selected.value;
  draft.analysisTypes = [...(d?.analysisTypes ?? [])]; draft.recipientUserIds = [...(d?.recipientUserIds ?? [])];
  draft.lookbackHours = d?.lookbackHours ?? 24; draft.maxConversationsPerRun = d?.maxConversationsPerRun ?? 100; draft.approvalRef = d?.approvalRef ?? '';
  const s = d?.schedule; schedule.enabled = s?.enabled ?? false; schedule.days = [...(s?.days ?? [1,2,3,4,5])]; schedule.windows = (s?.windows?.length ? s.windows : [{start:'08:00',end:'17:30'}]).map(w=>({...w}));
  scanPreview.value = null; scanResult.value = null; confirmedBatch.value = false;
}
async function save() {
  if (!selected.value || busy.value) return; busy.value = true; error.value = ''; notice.value = '';
  try { await qcRequest('put', `/department-monitoring/departments/${selected.value.id}`, { ...draft, enabled: false }); notice.value = 'Đã lưu cấu hình. Anh có thể bật AI khi các điều kiện bên dưới đã đủ.'; await load(); }
  catch (e: unknown) { error.value = errorMessage(e, 'Không lưu được cấu hình.'); }
  finally { busy.value = false; }
}
async function stop() {
  if (busy.value || !stopReason.value.trim()) return; busy.value = true; error.value = '';
  try { await qcRequest('post', '/department-monitoring/kill-switch', { reason: stopReason.value.trim() }); notice.value = 'Đã ghi audit xác nhận dừng khẩn cấp.'; stopDialog.value = false; stopReason.value = ''; await load(); }
  catch (e: unknown) { error.value = errorMessage(e, 'Không ghi nhận được thao tác dừng.'); }
  finally { busy.value = false; }
}
async function toggleAi(value:boolean|null) {
  if(!selected.value||busy.value||typeof value!=='boolean')return;
  busy.value=true;error.value='';notice.value='';scanPreview.value=null;confirmedBatch.value=false;
  try{await qcRequest('put',`/department-monitoring/departments/${selected.value.id}/enabled`,{enabled:value,version:selected.value.version});await load();notice.value=value?(state.value?.automatic?'Đã bật theo dõi liên tục. AI sẽ quét tin nhắn mới từ lúc này và báo người phụ trách khi có nội dung cần xem xét.':'Đã bật AI cho phòng ban. Chọn xem trước để bắt đầu quét.'):'Đã tắt AI cho phòng ban. Các lượt quét tiếp theo sẽ bị chặn.';}catch(e){error.value=errorMessage(e,'Không thay đổi được trạng thái AI.');}finally{busy.value=false;}
}
async function resume() {
  if(busy.value)return;busy.value=true;error.value='';
  try{await qcRequest('post','/department-monitoring/resume',{reason:'Quản trị viên mở lại quét thử tại giao diện.'});await load();notice.value='Đã mở lại quét thử. Bật AI cho từng phòng ban khi cần.';}catch(e){error.value=errorMessage(e,'Không mở lại được quét thử.');}finally{busy.value=false;}
}
async function previewScan() {
  if (!selected.value?.enabled || dirty.value || busy.value) return; busy.value = true; error.value = ''; notice.value = ''; scanPreview.value = null; scanResult.value = null; confirmedBatch.value = false;
  try { scanPreview.value = await qcRequest<ScanPreview>('post', `/department-monitoring/departments/${selected.value.id}/scan-preview`, {}); if (!scanPreview.value.candidates.length) notice.value = 'Không có hội thoại trong phạm vi đang chọn hoặc tài khoản không được phép xem.'; }
  catch (e: unknown) { error.value = errorMessage(e, 'Không tạo được bản xem trước quét.'); }
  finally { busy.value = false; }
}
async function runScan() {
  if (!selected.value?.enabled || !scanPreview.value || !confirmedBatch.value || !allReady.value || busy.value || scanning.value) return;
  scanning.value = true; error.value = ''; scanResult.value = null;
  try { scanResult.value = await qcRequest<ScanResult>('post', `/department-monitoring/departments/${selected.value.id}/scan`, { confirmed: true, items: scanPreview.value.candidates.map(v => ({conversationId:v.conversationId,previewToken:v.previewToken})) }); scanPreview.value = null; confirmedBatch.value = false; emit('refresh'); }
  catch (e: unknown) { error.value = errorMessage(e, 'Không chạy được lượt quét local.'); }
  finally { scanning.value = false; }
}
const jobState=(state:string)=>({PENDING:'Đang chờ',PROCESSING:'Đang phân tích',RETRY:'Chờ thử lại',DONE:'Đã phân tích',SKIPPED:'Bỏ qua',DEAD:'Cần kiểm tra'}[state]??'Chưa xác định');
let monitorTimer:ReturnType<typeof setInterval>|undefined;
onMounted(()=>{void load();monitorTimer=setInterval(()=>{if(busy.value||dirty.value||scheduleDirty.value||document.hidden)return;void qcRequest<State>('get','/department-monitoring').then(s=>{state.value=s;}).catch(()=>{});},5000);});
onUnmounted(()=>{if(monitorTimer)clearInterval(monitorTimer);});
</script>

<style scoped>
.schedule-panel{padding:18px 20px;border:1px solid rgba(127,145,175,.22);border-radius:12px;margin:0 0 18px}.schedule-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:8px}.schedule-head h3{font-size:14px;font-weight:650;display:flex;align-items:center}.schedule-head p{font-size:12px;color:var(--qc-muted);margin-top:6px}.schedule-label{display:block;font-size:12px;font-weight:600;margin:12px 0 6px}.schedule-window{display:flex;align-items:center;gap:10px;margin-bottom:8px;max-width:460px}.schedule-window .v-text-field{flex:1}@media(max-width:600px){.schedule-head{flex-direction:column;align-items:flex-start}}
.continuous-status{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;padding:14px;background:rgba(110,137,210,.04);border:1px solid var(--qc-border);border-radius:10px}.continuous-status p{width:100%;color:var(--qc-muted)}
.ai-toggle-panel{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:18px 20px;border:1px solid rgba(94,124,221,.18);background:rgba(94,124,221,.045);border-radius:12px;margin:0 0 18px}.ai-toggle-panel h3{font-size:14px;font-weight:650}.ai-toggle-panel p{font-size:12px;color:var(--qc-muted);margin-top:6px}.ai-toggle-panel :deep(.v-switch){flex:0 0 auto}.ai-toggle-panel :deep(.v-label){font-size:12px}@media(max-width:600px){.ai-toggle-panel{align-items:flex-start;flex-direction:column;gap:8px}}
.department-status{display:flex;gap:12px;align-items:center;margin:18px 0 22px;font-size:12px;color:var(--qc-muted)}.qc-message{padding:14px 16px;background:rgba(120,140,175,.06);border-radius:10px;margin:12px 0}.qc-message strong{font-size:11px;color:var(--qc-muted)}.qc-message p{margin-top:6px;font-size:13px;line-height:1.7}h2{font-size:18px}h2+p{font-size:13px;color:var(--qc-muted);margin-top:6px}blockquote{font-size:13px;line-height:1.7;border-left:3px solid #a4b6e8;padding-left:14px;margin:12px 0}
</style>
