<template>
 <v-card class="pa-4 my-4" variant="outlined">
  <h2>Trung tâm cảnh báo thử nghiệm</h2>
  <p>Dữ liệu mô phỏng · Nhận xét cần người duyệt.</p>
  <v-alert v-if="error" type="error">{{ error }}</v-alert>
  <v-alert v-if="!available" type="info">Giám sát thử nghiệm đang tắt hoặc chưa sẵn sàng.</v-alert>
  <v-btn :loading="busy" @click="refresh">Tải cảnh báo</v-btn>
  <template v-if="available">
   <p>Cảnh báo đang mở: {{ warnings.filter(w=>w.status==='OPEN').length }}</p>
   <div v-for="category in categories" :key="category">{{ qcLabel(category) }}: {{ warnings.filter(w=>w.category===category&&w.status==='OPEN').length }}</div>
   <details v-if="health"><summary>Trạng thái xử lý</summary><pre>{{ JSON.stringify(health,null,2) }}</pre></details>
   <v-table><thead><tr><th>Loại</th><th>Trạng thái</th><th>Dữ liệu theo dõi</th><th></th></tr></thead><tbody>
    <tr v-for="w in warnings" :key="w.id"><td>{{ qcLabel(w.category) }}</td><td>{{ qcLabel(w.status) }}</td><td>{{ qcLabel(w.coverage) }}</td><td><v-btn @click="open(w.id)">Xem bằng chứng</v-btn></td></tr>
    <tr v-if="!warnings.length"><td colspan="4">Chưa có cảnh báo được phép truy cập.</td></tr>
   </tbody></v-table>
   <v-navigation-drawer v-if="selected" v-model="drawer" location="right" temporary width="620">
    <div class="pa-4"><h3>{{ qcLabel(selected.category) }} · {{ qcLabel(selected.status) }}</h3><p>{{ selected.id }}</p><p>Nhân viên: {{ selected.employeeId??'Chưa xác định' }}</p><details><summary>Mã xác thực</summary><p>{{ selected.evidenceHash }}</p></details>
     <p>{{ selected.missingContext.map(qcLabel).join(', ') }}</p>
     <div v-for="finding in selected.evidence?.output.findings??[]" :key="finding.type"><h4>{{ qcLabel(finding.type) }} · {{ qcLabel(finding.status) }}</h4><p>{{ finding.explanation }}</p>
      <blockquote v-for="c in finding.citations" :key="c.documentId+':'+c.byteStart">{{ c.quote }}<p>revision {{ c.revision }} · bytes [{{ c.byteStart }}, {{ c.byteEnd }}) · {{ c.contentHash }}</p></blockquote>
     </div>
     <pre>{{ JSON.stringify(selected.evidence?.conversation.messages,null,2) }}</pre>
     <template v-if="permissions.includes('approve')"><v-textarea v-model="reason" label="Lý do review" /><v-btn :disabled="busy||!reason.trim()" @click="review('ACKNOWLEDGED')">Đã xem / cần theo dõi</v-btn><v-btn :disabled="busy||!reason.trim()" @click="review('DISMISSED')">Bác bỏ nhận xét</v-btn></template>
     <pre>{{ JSON.stringify(selected.reviews,null,2) }}</pre>
    </div>
   </v-navigation-drawer>
  </template>
 </v-card>
</template>
<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue';
import {io,type Socket} from 'socket.io-client';
import {readToken} from '@/api/index';
import {monitoringApi,type MonitoringWarning,type MonitoringHealth} from '@/api/ai-qc-monitoring';
import {qcError,qcLabel} from './presentation';
defineProps<{permissions:string[]}>();
const warnings=ref<MonitoringWarning[]>([]),health=ref<MonitoringHealth|null>(null),selected=ref<MonitoringWarning|null>(null),drawer=ref(false),reason=ref(''),error=ref(''),busy=ref(false),available=ref(false);
const categories=['CONDUCT_NEEDS_REVIEW','UNANSWERED_CONVERSATION','SLA_BREACH','CUSTOMER_CARE_OVERDUE','UNRESOLVED_REQUEST','INSUFFICIENT_EVIDENCE'];
let socket:Socket|undefined;const seen=new Set<string>();
async function refresh(){if(busy.value)return;busy.value=true;error.value='';try{const result=await monitoringApi.list();if(!result.enabled||!result.syntheticOnly)throw Error('SYNTHETIC_MONITORING_REQUIRED');warnings.value=result.warnings;available.value=true;try{health.value=await monitoringApi.health();}catch{health.value=null;}}catch(e){available.value=false;warnings.value=[];selected.value=null;error.value=qcError((e as {response?:{data?:{error?:string}}}).response?.data?.error);}finally{busy.value=false;}}
async function open(id:string){try{selected.value=await monitoringApi.detail(id);drawer.value=true;reason.value='';}catch{error.value='Không có quyền xem chứng cứ hoặc chứng cứ không hợp lệ.';selected.value=null;}}
async function review(status:string){if(!selected.value)return;try{selected.value=await monitoringApi.review(selected.value.id,selected.value.version,status,reason.value);reason.value='';await refresh();}catch{error.value='Review bị từ chối hoặc đã thay đổi; tải lại chứng cứ.';}}
onMounted(async()=>{await refresh();if(!available.value)return;socket=io('/ai-qc-monitoring',{auth:{token:readToken()},transports:['websocket'],autoConnect:false});socket.on('qc:warning-updated',(event:{id?:string})=>{if(typeof event.id!=='string')return;socket?.emit('qc:ack',event.id);if(seen.has(event.id))return;seen.add(event.id);if(seen.size>500)seen.delete(seen.values().next().value!);void refresh();});socket.on('connect',()=>{void refresh();});socket.on('connect_error',()=>{error.value='Realtime chưa kết nối; có thể tải lại danh sách.';});socket.connect();});
onUnmounted(()=>{socket?.disconnect();seen.clear();});
</script>
