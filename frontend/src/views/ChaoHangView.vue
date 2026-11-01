<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api';
import ManualPostingPanel from '@/components/posting/ManualPostingPanel.vue';

interface ChaoHangJob {
  id: string;
  botJobId: number;
  poCode: string | null;
  zaloAccountId: string;
  status: 'running' | 'done' | 'failed';
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  error: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
interface ChaoHangResult {
  id: string;
  customerId: number;
  name: string | null;
  phone: string | null;
  tier: string | null;
  uidUsed: string | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  error: string | null;
  imagesCount: number;
  sentAt: string | null;
  createdAt: string;
}

const jobs = ref<ChaoHangJob[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 30;
const loading = ref(false);
const statusFilter = ref<string | null>(null);

// Chi tiết (dialog)
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailJob = ref<ChaoHangJob | null>(null);
const detailResults = ref<ChaoHangResult[]>([]);

const statusOptions = [
  { title: 'Tất cả', value: null },
  { title: 'Đang chạy', value: 'running' },
  { title: 'Hoàn tất', value: 'done' },
  { title: 'Lỗi', value: 'failed' },
];

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

async function fetchJobs() {
  loading.value = true;
  try {
    const params: Record<string, unknown> = { page: page.value, limit };
    if (statusFilter.value) params.status = statusFilter.value;
    const res = await api.get('/chao-hang/jobs', { params });
    jobs.value = res.data.jobs;
    total.value = res.data.total;
  } catch (err) {
    console.error('Failed to fetch chao-hang jobs:', err);
  } finally {
    loading.value = false;
  }
}

async function openDetail(job: ChaoHangJob) {
  detailOpen.value = true;
  detailLoading.value = true;
  detailJob.value = job;
  detailResults.value = [];
  try {
    const res = await api.get(`/chao-hang/jobs/${job.id}`);
    detailJob.value = res.data.job;
    detailResults.value = res.data.results;
  } catch (err) {
    console.error('Failed to fetch chao-hang job detail:', err);
  } finally {
    detailLoading.value = false;
  }
}

function applyFilter() {
  page.value = 1;
  fetchJobs();
}
function changePage(delta: number) {
  const next = page.value + delta;
  if (next < 1 || next > totalPages.value) return;
  page.value = next;
  fetchJobs();
}

function jobStatusColor(s: string): string {
  return s === 'done' ? 'success' : s === 'failed' ? 'error' : 'info';
}
function jobStatusLabel(s: string): string {
  return s === 'done' ? 'Hoàn tất' : s === 'failed' ? 'Lỗi' : 'Đang chạy';
}
function resultColor(s: string): string {
  return s === 'sent' ? 'success' : s === 'failed' ? 'error' : s === 'skipped' ? 'warning' : 'grey';
}
function resultIcon(s: string): string {
  return s === 'sent' ? 'mdi-check-circle' : s === 'failed' ? 'mdi-alert-circle' : s === 'skipped' ? 'mdi-debug-step-over' : 'mdi-clock-outline';
}
function resultLabel(s: string): string {
  return s === 'sent' ? 'Đã gửi' : s === 'failed' ? 'Lỗi' : s === 'skipped' ? 'Bỏ qua' : 'Chờ';
}
function successRate(job: ChaoHangJob): string {
  const denom = job.sentCount + job.failedCount;
  if (denom === 0) return '—';
  return `${Math.round((job.sentCount / denom) * 100)}%`;
}
function fmtTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString('vi-VN') : '—';
}

onMounted(fetchJobs);
</script>

<template>
  <v-container fluid class="pa-4">
    <div class="d-flex align-center mb-4">
      <h2 class="text-h5 font-weight-bold">🛍️ Chào hàng</h2>
      <v-spacer />
      <v-btn variant="text" :loading="loading" prepend-icon="mdi-refresh" @click="fetchJobs">Tải lại</v-btn>
    </div>

    <ManualPostingPanel kind="OFFER" />

    <h3 class="text-subtitle-1 mb-2">Nhật ký chào hàng từ BOT</h3>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Job chào hàng do BOT nội bộ bắn sang; CRM gửi ảnh chào hàng theo tier khách qua 1 nick cố định.
      Mỗi dòng là 1 job; bấm để xem kết quả gửi từng khách.
    </p>

    <v-row class="mb-2" dense>
      <v-col cols="12" sm="4" md="3">
        <v-select v-model="statusFilter" :items="statusOptions" label="Trạng thái"
          density="compact" hide-details @update:model-value="applyFilter" />
      </v-col>
    </v-row>

    <v-card variant="flat" border>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Mã phiếu</th>
            <th class="text-center">Tổng khách</th>
            <th class="text-center">Gửi / Lỗi / Bỏ qua</th>
            <th class="text-center">Tỷ lệ thành công</th>
            <th class="text-center">Trạng thái</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="job in jobs" :key="job.id" style="cursor: pointer" @click="openDetail(job)">
            <td class="text-no-wrap">{{ fmtTime(job.createdAt) }}</td>
            <td>{{ job.poCode || ('#' + job.botJobId) }}</td>
            <td class="text-center">{{ job.totalCount }}</td>
            <td class="text-center">
              <span class="text-success">{{ job.sentCount }}</span> /
              <span class="text-error">{{ job.failedCount }}</span> /
              <span class="text-warning">{{ job.skippedCount }}</span>
            </td>
            <td class="text-center">{{ successRate(job) }}</td>
            <td class="text-center">
              <v-chip :color="jobStatusColor(job.status)" size="small" variant="flat">
                {{ jobStatusLabel(job.status) }}
              </v-chip>
            </td>
            <td class="text-center"><v-icon size="small">mdi-chevron-right</v-icon></td>
          </tr>
          <tr v-if="!loading && jobs.length === 0">
            <td colspan="7" class="text-center text-medium-emphasis py-8">Chưa có job chào hàng nào.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <div class="d-flex align-center justify-center mt-4 gap-2">
      <v-btn variant="text" size="small" :disabled="page <= 1" @click="changePage(-1)">‹ Trước</v-btn>
      <span class="text-body-2">Trang {{ page }}/{{ totalPages }} ({{ total }} job)</span>
      <v-btn variant="text" size="small" :disabled="page >= totalPages" @click="changePage(1)">Sau ›</v-btn>
    </div>

    <!-- Chi tiết job -->
    <v-dialog v-model="detailOpen" max-width="900" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center">
          <span>Chi tiết job {{ detailJob?.poCode || ('#' + detailJob?.botJobId) }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="detailOpen = false" />
        </v-card-title>
        <v-divider />
        <v-card-text style="max-height: 70vh">
          <div v-if="detailLoading" class="text-center py-8">
            <v-progress-circular indeterminate />
          </div>
          <template v-else>
            <div v-if="detailJob" class="mb-3 d-flex flex-wrap gap-2">
              <v-chip size="small" variant="tonal">Tổng: {{ detailJob.totalCount }}</v-chip>
              <v-chip size="small" color="success" variant="tonal">Gửi: {{ detailJob.sentCount }}</v-chip>
              <v-chip size="small" color="error" variant="tonal">Lỗi: {{ detailJob.failedCount }}</v-chip>
              <v-chip size="small" color="warning" variant="tonal">Bỏ qua: {{ detailJob.skippedCount }}</v-chip>
              <v-chip size="small" :color="jobStatusColor(detailJob.status)" variant="flat">
                {{ jobStatusLabel(detailJob.status) }}
              </v-chip>
            </div>
            <v-alert v-if="detailJob?.error" type="error" density="compact" variant="tonal" class="mb-3">
              {{ detailJob.error }}
            </v-alert>

            <v-table density="compact">
              <thead>
                <tr>
                  <th>Khách</th>
                  <th>SĐT</th>
                  <th class="text-center">Tier</th>
                  <th class="text-center">Ảnh</th>
                  <th class="text-center">Kết quả</th>
                  <th>Lỗi</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in detailResults" :key="r.id">
                  <td>{{ r.name || ('KH#' + r.customerId) }}</td>
                  <td class="text-no-wrap">{{ r.phone || '—' }}</td>
                  <td class="text-center">{{ r.tier || '—' }}</td>
                  <td class="text-center">{{ r.imagesCount }}</td>
                  <td class="text-center">
                    <v-chip :color="resultColor(r.status)" size="x-small" variant="flat">
                      <v-icon start size="x-small">{{ resultIcon(r.status) }}</v-icon>
                      {{ resultLabel(r.status) }}
                    </v-chip>
                  </td>
                  <td class="text-error text-caption">{{ r.error || '' }}</td>
                </tr>
                <tr v-if="detailResults.length === 0">
                  <td colspan="6" class="text-center text-medium-emphasis py-6">Chưa có kết quả.</td>
                </tr>
              </tbody>
            </v-table>
          </template>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped>
.gap-2 { gap: 8px; }
</style>
