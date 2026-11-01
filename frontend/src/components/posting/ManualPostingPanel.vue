<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { manualPosting, type PostingAccount, type PostingDraft, type PostingJob, type PostingKind, type PostingRecipient, type PostingTarget } from '@/api/manual-posting';

const props = defineProps<{ kind: PostingKind }>();
const enabled = ref(false), ready = ref(false), initializing = ref(false), error = ref(''), notice = ref('');
const statusKnown = ref(false);
const accounts = ref<PostingAccount[]>([]), accountId = ref<string | null>(null);
const search = ref(''), targets = ref<PostingTarget[]>([]), selected = ref<string[]>([]);
const selectedNames = ref<Record<string, string>>({}), nextOffset = ref<number | null>(null), loadingTargets = ref(false);
const body = ref(''), imagesText = ref(''), delay = ref(10);
const confirming = ref(false), confirmed = ref(false), sending = ref(false), pending = ref<PostingDraft | null>(null);
const jobs = ref<PostingJob[]>([]), jobsLoading = ref(false), pollBlocked = ref(false);
const detailOpen = ref(false), detailLoading = ref(false), detailJob = ref<PostingJob | null>(null), recipients = ref<PostingRecipient[]>([]);
const cancelling = ref(false), detailError = ref('');
let targetGeneration = 0, disposed = false, debounce: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
const group = computed(() => props.kind === 'GROUP');
const noun = computed(() => group.value ? 'nhóm' : 'khách');
const imageUrls = computed(() => imagesText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean));
const selectedAccount = computed(() => accounts.value.find(a => a.id === accountId.value));
const targetOptions = computed(() => {
  const map = new Map<string, PostingTarget>();
  for (const id of selected.value) map.set(id, { id, name: selectedNames.value[id] || id });
  for (const t of targets.value) map.set(t.id, t);
  return [...map.values()];
});
const locked = computed(() => sending.value || pending.value !== null);
const validation = computed(() => {
  if (!ready.value) return 'Chức năng chưa được kích hoạt.';
  if (!selectedAccount.value || selectedAccount.value.status !== 'connected') return 'Chọn nick đang kết nối.';
  if (!selected.value.length || selected.value.length > 50) return `Chọn từ 1 đến 50 ${noun.value}.`;
  if (body.value.trim().length > 2000) return 'Nội dung tối đa 2.000 ký tự.';
  if (!body.value.trim() && !imageUrls.value.length) return 'Nhập nội dung hoặc URL ảnh.';
  if (imageUrls.value.length > 10) return 'Tối đa 10 URL ảnh.';
  for (const url of imageUrls.value) {
    try { const u = new URL(url); if (u.protocol !== 'https:' || u.username || u.password || url.length > 2048) return 'Ảnh phải là URL HTTPS công khai, không chứa thông tin đăng nhập.'; }
    catch { return 'Có URL ảnh không hợp lệ.'; }
  }
  if (!Number.isInteger(Number(delay.value)) || Number(delay.value) < 10 || Number(delay.value) > 300) return 'Khoảng nghỉ từ 10 đến 300 giây.';
  return '';
});
function message(e: unknown): string {
  const value = e as { response?: { data?: { error?: unknown } } };
  return typeof value.response?.data?.error === 'string' ? value.response.data.error : 'Không kết nối được máy chủ. Vui lòng thử lại.';
}
function label(status: string) {
  return ({ QUEUED: 'Chờ gửi', RUNNING: 'Đang gửi', SENDING: 'Đang gửi', SENT: 'SDK xác nhận gửi', DONE: 'Hoàn tất', PARTIAL: 'Gửi một phần', FAILED: 'Đã dừng / lỗi', UNKNOWN: 'Chưa rõ kết quả', CANCELLED: 'Đã hủy', SKIPPED: 'Bỏ qua' } as Record<string, string>)[status] || status;
}
function color(status: string) { return ['DONE', 'SENT'].includes(status) ? 'success' : ['UNKNOWN', 'PARTIAL'].includes(status) ? 'warning' : status === 'FAILED' ? 'error' : 'secondary'; }
function time(value: string) { return new Date(value).toLocaleString('vi-VN'); }
function choose(ids: string[]) {
  selected.value = ids;
  for (const t of targetOptions.value) if (ids.includes(t.id)) selectedNames.value[t.id] = t.name;
}
async function loadTargets(append = false) {
  const generation = ++targetGeneration;
  const account = accountId.value;
  if (!account || !ready.value) { targets.value = []; nextOffset.value = null; loadingTargets.value = false; return; }
  loadingTargets.value = true;
  try {
    const result = await manualPosting.targets(account, props.kind, search.value, append ? nextOffset.value ?? 0 : 0);
    if (disposed || generation !== targetGeneration) return;
    targets.value = append ? [...targets.value, ...result.targets] : result.targets;
    nextOffset.value = result.nextOffset;
  } catch (e) { if (!disposed && generation === targetGeneration) error.value = message(e); }
  finally { if (generation === targetGeneration) loadingTargets.value = false; }
}
watch(accountId, () => {
  selected.value = []; selectedNames.value = {}; targets.value = []; nextOffset.value = null;
  if (debounce) clearTimeout(debounce);
  void loadTargets();
});
watch(search, () => {
  ++targetGeneration;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => { void loadTargets(); }, 350);
});
async function loadJobs() {
  if (!ready.value || jobsLoading.value) return;
  jobsLoading.value = true;
  try { const result = await manualPosting.jobs(props.kind); if (!disposed) { jobs.value = result; pollBlocked.value = false; } }
  catch (e) { if (!disposed) { error.value = message(e); pollBlocked.value = true; } }
  finally { jobsLoading.value = false; }
}
async function initialize() {
  initializing.value = true; error.value = ''; ready.value = false; statusKnown.value = false;
  try {
    const status = await manualPosting.status();
    if (disposed) return;
    enabled.value = status.enabled; statusKnown.value = true;
    if (!status.ready) return;
    const result = await manualPosting.accounts();
    if (disposed) return;
    accounts.value = result; ready.value = true;
    if (accountId.value) await loadTargets();
    await loadJobs();
  } catch (e) {
    if (!disposed) {
      const status = (e as { response?: { status?: number } }).response?.status;
      error.value = !statusKnown.value && status === 404
        ? 'Backend hiện tại chưa cung cấp API gửi bài (/api/v1/manual-posting/status). Cần cập nhật và khởi động lại đúng backend mà giao diện đang kết nối; tải lại trang không cập nhật được backend.'
        : message(e);
    }
  }
  finally { initializing.value = false; }
}
function preview() { confirmed.value = false; confirming.value = true; }
async function submit() {
  if (sending.value || !confirmed.value || (!pending.value && validation.value)) return;
  error.value = ''; notice.value = '';
  if (!pending.value) pending.value = {
    requestId: crypto.randomUUID(), zaloAccountId: accountId.value!, kind: props.kind,
    targetIds: [...selected.value], body: body.value.trim(), imageUrls: [...imageUrls.value], delaySeconds: Number(delay.value), confirmed: true,
  };
  sending.value = true;
  try {
    const result = await manualPosting.create(pending.value);
    if (disposed) return;
    notice.value = `${result.duplicate ? 'Yêu cầu đã có trong nhật ký' : 'Đã xếp hàng gửi'} — mã ${result.job.id}.`;
    pending.value = null; selected.value = []; confirming.value = false; confirmed.value = false;
    await loadJobs();
  } catch (e) {
    error.value = `${message(e)} Chưa xác nhận được yêu cầu đã được ghi nhận hay chưa. Giữ nguyên mã yêu cầu khi thử lại để tránh tạo lượt trùng.`;
  } finally { sending.value = false; }
}
function newDraft() {
  if (sending.value) return;
  if (!window.confirm('Hãy kiểm tra nhật ký và Zalo trước. Tạo lượt mới có thể gửi trùng nếu lượt trước đã được ghi nhận. Anh muốn bỏ mã yêu cầu hiện tại?')) return;
  pending.value = null; selected.value = []; confirming.value = false; error.value = '';
}
async function openDetail(job: PostingJob) {
  detailOpen.value = true; detailLoading.value = true; detailError.value = ''; detailJob.value = job; recipients.value = [];
  try { const result = await manualPosting.detail(job.id); if (!disposed) { detailJob.value = result.job; recipients.value = result.recipients; } }
  catch (e) { detailError.value = message(e); }
  finally { detailLoading.value = false; }
}
async function cancelJob() {
  const job = detailJob.value;
  if (!job || cancelling.value || !window.confirm('Dừng các mục chưa gửi? Tin đã gửi không được thu hồi; mục đang gửi có thể chưa rõ kết quả.')) return;
  cancelling.value = true; detailError.value = '';
  try { await manualPosting.cancel(job.id); await openDetail(job); await loadJobs(); }
  catch (e) { detailError.value = message(e); }
  finally { cancelling.value = false; }
}
function preventLeaving(e: BeforeUnloadEvent) { if (pending.value || sending.value) { e.preventDefault(); e.returnValue = ''; } }
onMounted(() => {
  void initialize();
  window.addEventListener('beforeunload', preventLeaving);
  poll = setInterval(() => { if (!pollBlocked.value && jobs.value.some(j => ['QUEUED', 'RUNNING'].includes(j.status))) void loadJobs(); }, 5000);
});
onBeforeUnmount(() => {
  disposed = true; ++targetGeneration;
  if (poll) clearInterval(poll);
  if (debounce) clearTimeout(debounce);
  window.removeEventListener('beforeunload', preventLeaving);
});
</script>

<template>
  <v-card border class="mb-6" variant="flat">
    <v-card-title>{{ group ? 'Soạn bài đăng nhóm' : 'Soạn chào hàng' }}</v-card-title>
    <v-card-text>
      <v-progress-linear v-if="initializing" indeterminate class="mb-3" />
      <v-alert v-if="error" type="error" variant="tonal" class="mb-3">{{ error }}</v-alert>
      <v-alert v-if="notice" type="success" variant="tonal" class="mb-3">{{ notice }}</v-alert>
      <v-alert v-if="statusKnown && !ready && !initializing" type="info" variant="tonal" class="mb-3">
        {{ enabled ? 'Chưa sẵn sàng. Quản trị viên cần kiểm tra migration và cấu hình máy chủ.' : 'Gửi trực tiếp từ CRM chưa được kích hoạt. Nhật ký BOT phía dưới vẫn sử dụng như trước.' }}
        <v-btn variant="text" size="small" @click="initialize">Kiểm tra lại</v-btn>
      </v-alert>
      <v-btn v-if="!statusKnown && !initializing" variant="text" size="small" class="mb-3" @click="initialize">Kiểm tra lại kết nối backend</v-btn>
      <template v-if="ready">
        <p class="text-body-2 mb-4">Chỉ dùng nick công việc có quyền chat. {{ group ? 'Chọn nhóm đã được đồng bộ vào CRM.' : 'Chỉ chọn khách đã kết bạn với nick gửi và thuộc quyền truy cập của anh.' }}</p>
        <v-row>
          <v-col cols="12" md="6">
            <v-select v-model="accountId" :disabled="locked" :items="accounts.map(a => ({ title: `${a.displayName || a.id}${a.status === 'connected' ? '' : ' — chưa kết nối'}`, value: a.id, props: { disabled: a.status !== 'connected' } }))" label="Nick Zalo gửi" />
          </v-col>
          <v-col cols="12" md="6"><v-text-field v-model="search" :disabled="locked || !accountId" :label="`Tìm ${noun} theo tên`" clearable @click:clear="search = ''" /></v-col>
        </v-row>
        <v-autocomplete :model-value="selected" :items="targetOptions" item-title="name" item-value="id" :label="`Chọn ${noun} (${selected.length}/50)`" multiple chips closable-chips no-filter :disabled="locked || !accountId" :loading="loadingTargets" no-data-text="Chưa có kết quả. Thử tên khác hoặc đồng bộ dữ liệu nick." @update:model-value="choose" />
        <v-btn v-if="nextOffset !== null" size="small" variant="text" :disabled="locked" :loading="loadingTargets" class="mb-3" @click="loadTargets(true)">Tải thêm {{ noun }}</v-btn>
        <v-textarea v-model="body" label="Nội dung" :disabled="locked" :counter="2000" rows="5" auto-grow />
        <v-textarea v-model="imagesText" label="URL ảnh HTTPS — mỗi dòng một URL" :disabled="locked" rows="2" hint="Tối đa 10 ảnh; 25 MB/ảnh, tổng 50 MB. Hỗ trợ JPEG, PNG, WebP, GIF." persistent-hint class="mb-4" />
        <v-text-field v-model.number="delay" type="number" min="10" max="300" step="1" label="Khoảng nghỉ giữa hai người nhận (giây)" :disabled="locked" />
        <div class="d-flex flex-wrap ga-2 align-center">
          <v-btn color="primary" :disabled="!!validation || sending" @click="preview">{{ pending ? 'Xác nhận lại yêu cầu cũ' : 'Xem lại và gửi' }}</v-btn>
          <v-btn v-if="pending" variant="text" :disabled="sending" @click="newDraft">Bỏ yêu cầu để soạn lượt mới</v-btn>
          <span v-if="validation" class="text-caption text-medium-emphasis">{{ validation }}</span>
        </div>
        <v-alert v-if="pending" type="warning" variant="tonal" class="mt-3">Giữ nguyên nội dung và mã yêu cầu {{ pending.requestId }} để tránh gửi trùng. Không tạo lượt mới trước khi kiểm tra nhật ký.</v-alert>
        <v-divider class="my-5" />
        <div class="d-flex align-center mb-2"><h3 class="text-subtitle-1">20 lượt gửi gần nhất từ CRM</h3><v-spacer /><v-btn size="small" variant="text" :loading="jobsLoading" @click="loadJobs">Tải lại</v-btn></div>
        <v-table density="compact">
          <thead><tr><th>Thời gian</th><th>Nội dung</th><th>Tiến độ</th><th>Trạng thái</th><th></th></tr></thead>
          <tbody>
            <tr v-for="job in jobs" :key="job.id"><td>{{ time(job.createdAt) }}</td><td>{{ job.body.slice(0, 80) || '(Chỉ có ảnh)' }}</td><td>{{ job.sent ?? 0 }}/{{ job.total ?? 0 }}</td><td><v-chip size="small" :color="color(job.status)">{{ label(job.status) }}</v-chip></td><td><v-btn size="small" variant="text" @click="openDetail(job)">Chi tiết</v-btn></td></tr>
            <tr v-if="!jobs.length"><td colspan="5">{{ jobsLoading ? 'Đang tải…' : pollBlocked ? 'Không tải được nhật ký. Bấm Tải lại.' : 'Chưa có lượt gửi từ CRM.' }}</td></tr>
          </tbody>
        </v-table>
      </template>
    </v-card-text>
  </v-card>
  <v-dialog v-model="confirming" max-width="680" :persistent="sending">
    <v-card>
      <v-card-title>Xác nhận {{ group ? 'đăng nhóm' : 'gửi chào hàng' }}</v-card-title>
      <v-card-text>
        <p class="mb-2">Nick: <strong>{{ selectedAccount?.displayName || accountId }}</strong> · {{ selected.length }} {{ noun }} · {{ imageUrls.length }} ảnh · nghỉ {{ delay }} giây.</p>
        <p class="text-body-2 mb-3">{{ selected.map(id => selectedNames[id] || id).join(', ') }}</p>
        <div class="posting-preview pa-3 bg-grey-lighten-4 rounded">{{ body.trim() || '(Chỉ gửi ảnh)' }}</div>
        <div v-for="url in imageUrls" :key="url" class="text-caption text-break mt-1">{{ url }}</div>
        <v-checkbox v-model="confirmed" label="Tôi đã kiểm tra nội dung và đúng người nhận." hide-details :disabled="sending" />
        <v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions><v-spacer /><v-btn :disabled="sending" @click="confirming = false">Quay lại</v-btn><v-btn color="primary" :loading="sending" :disabled="!confirmed || !!validation" @click="submit">{{ pending ? 'Gửi lại cùng mã yêu cầu' : 'Xác nhận gửi' }}</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
  <v-dialog v-model="detailOpen" max-width="850">
    <v-card>
      <v-card-title>Chi tiết lượt gửi từ CRM</v-card-title>
      <v-card-text>
        <v-progress-linear v-if="detailLoading" indeterminate />
        <v-alert v-if="detailError" type="error" variant="tonal">{{ detailError }}</v-alert>
        <template v-else-if="detailJob">
          <p class="text-caption mb-2">{{ detailJob.id }} · {{ label(detailJob.status) }}</p>
          <div class="posting-preview mb-3">{{ detailJob.body || '(Chỉ có ảnh)' }}</div>
          <v-alert v-if="detailJob.lastError" type="warning" variant="tonal" class="mb-3">{{ detailJob.lastError }}</v-alert>
          <v-alert v-if="detailJob.status === 'UNKNOWN'" type="warning" variant="tonal" class="mb-3">Kiểm tra trực tiếp trên Zalo trước khi quyết định gửi lại. Hệ thống không tự gửi lại khi chưa rõ kết quả.</v-alert>
          <v-table><thead><tr><th>Người nhận</th><th>Kết quả</th><th>Ghi chú</th></tr></thead><tbody><tr v-for="r in recipients" :key="r.id"><td>{{ r.name }}</td><td>{{ label(r.status) }}</td><td>{{ r.error || (r.sentAt ? time(r.sentAt) : '—') }}</td></tr></tbody></v-table>
          <p class="text-caption mt-3">SDK xác nhận gửi không đồng nghĩa người nhận đã nhận hoặc đã đọc.</p>
        </template>
      </v-card-text>
      <v-card-actions><v-btn v-if="detailJob && ['QUEUED','RUNNING'].includes(detailJob.status)" color="error" :loading="cancelling" :disabled="detailLoading" @click="cancelJob">Dừng lượt gửi</v-btn><v-spacer /><v-btn v-if="detailJob" :disabled="detailLoading" @click="openDetail(detailJob)">Tải lại</v-btn><v-btn @click="detailOpen = false">Đóng</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.posting-preview { white-space: pre-wrap; overflow-wrap: anywhere; }
</style>
