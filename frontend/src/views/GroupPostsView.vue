<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api } from '@/api';
import ManualPostingPanel from '@/components/posting/ManualPostingPanel.vue';

interface GroupResult {
  groupId: string;
  groupName: string | null;
  ok: boolean;
  error?: string;
  zaloMsgId?: string;
}
interface PostLog {
  id: string;
  zaloAccountId: string;
  accountName: string | null;
  content: string | null;
  imageUrls: string[];
  groupResults: GroupResult[];
  sentCount: number;
  failedCount: number;
  status: 'ok' | 'partial' | 'failed';
  source: string;
  externalRef: string | null;
  createdAt: string;
}

const logs = ref<PostLog[]>([]);
const total = ref(0);
const page = ref(1);
const limit = 30;
const loading = ref(false);
const statusFilter = ref<string | null>(null);
const accountFilter = ref<string | null>(null);
const expanded = ref<Set<string>>(new Set());

const statusOptions = [
  { title: 'Tất cả', value: null },
  { title: 'Thành công', value: 'ok' },
  { title: 'Một phần lỗi', value: 'partial' },
  { title: 'Thất bại', value: 'failed' },
];

// Danh sách nick (lọc) lấy từ chính log đã tải.
const accountOptions = computed(() => {
  const m = new Map<string, string>();
  for (const l of logs.value) if (l.accountName) m.set(l.zaloAccountId, l.accountName);
  return [{ title: 'Tất cả nick', value: null }, ...[...m].map(([value, title]) => ({ title, value }))];
});

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

async function fetchLogs() {
  loading.value = true;
  try {
    const params: Record<string, unknown> = { page: page.value, limit };
    if (statusFilter.value) params.status = statusFilter.value;
    if (accountFilter.value) params.accountId = accountFilter.value;
    const res = await api.get('/group-post-logs', { params });
    logs.value = res.data.logs;
    total.value = res.data.total;
  } catch (err) {
    console.error('Failed to fetch group post logs:', err);
  } finally {
    loading.value = false;
  }
}

function applyFilter() {
  page.value = 1;
  fetchLogs();
}
function changePage(delta: number) {
  const next = page.value + delta;
  if (next < 1 || next > totalPages.value) return;
  page.value = next;
  fetchLogs();
}
function toggleExpand(id: string) {
  if (expanded.value.has(id)) expanded.value.delete(id);
  else expanded.value.add(id);
  expanded.value = new Set(expanded.value);
}

function statusColor(s: string): string {
  return s === 'ok' ? 'success' : s === 'partial' ? 'warning' : 'error';
}
function statusLabel(s: string): string {
  return s === 'ok' ? 'Thành công' : s === 'partial' ? 'Một phần lỗi' : 'Thất bại';
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('vi-VN');
}
function preview(c: string | null): string {
  if (!c) return '(không có nội dung)';
  return c.length > 60 ? c.slice(0, 60) + '…' : c;
}

onMounted(fetchLogs);
</script>

<template>
  <v-container fluid class="pa-4">
    <div class="d-flex align-center mb-4">
      <h2 class="text-h5 font-weight-bold">📢 Đăng nhóm</h2>
      <v-spacer />
      <v-btn variant="text" :loading="loading" prepend-icon="mdi-refresh" @click="fetchLogs">Tải lại</v-btn>
    </div>

    <ManualPostingPanel kind="GROUP" />

    <h3 class="text-subtitle-1 mb-2">Nhật ký đăng nhóm từ BOT</h3>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Ghi nhận các bài đăng từ bot nội bộ bắn qua. Mỗi dòng là 1 lần đăng; bấm để xem kết quả từng nhóm và soi lỗi.
    </p>

    <v-row class="mb-2" dense>
      <v-col cols="12" sm="4" md="3">
        <v-select v-model="statusFilter" :items="statusOptions" label="Trạng thái"
          density="compact" hide-details @update:model-value="applyFilter" />
      </v-col>
      <v-col cols="12" sm="4" md="3">
        <v-select v-model="accountFilter" :items="accountOptions" label="Tài khoản"
          density="compact" hide-details @update:model-value="applyFilter" />
      </v-col>
    </v-row>

    <v-card variant="flat" border>
      <v-table density="comfortable">
        <thead>
          <tr>
            <th>Thời gian</th>
            <th>Nick</th>
            <th>Nội dung</th>
            <th class="text-center">Ảnh</th>
            <th class="text-center">Nhóm</th>
            <th class="text-center">Kết quả</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="log in logs" :key="log.id">
            <tr style="cursor: pointer" @click="toggleExpand(log.id)">
              <td class="text-no-wrap">{{ fmtTime(log.createdAt) }}</td>
              <td>{{ log.accountName || log.zaloAccountId }}</td>
              <td>{{ preview(log.content) }}</td>
              <td class="text-center">{{ log.imageUrls?.length || 0 }}</td>
              <td class="text-center">{{ log.groupResults?.length || 0 }}</td>
              <td class="text-center">
                <v-chip :color="statusColor(log.status)" size="small" variant="flat">
                  {{ log.sentCount }}/{{ log.sentCount + log.failedCount }} · {{ statusLabel(log.status) }}
                </v-chip>
              </td>
              <td class="text-center">
                <v-icon size="small">{{ expanded.has(log.id) ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
              </td>
            </tr>
            <tr v-if="expanded.has(log.id)" :key="log.id + '-d'">
              <td colspan="7" class="pa-0">
                <div class="pa-4" style="background: rgba(0,0,0,0.03)">
                  <div v-if="log.content" class="mb-3">
                    <strong>Nội dung:</strong>
                    <pre class="content-pre">{{ log.content }}</pre>
                  </div>
                  <div v-if="log.externalRef" class="text-caption mb-2">Mã tham chiếu bot: {{ log.externalRef }}</div>
                  <strong>Kết quả từng nhóm:</strong>
                  <v-list density="compact" class="mt-1" bg-color="transparent">
                    <v-list-item v-for="g in log.groupResults" :key="g.groupId">
                      <template #prepend>
                        <v-icon :color="g.ok ? 'success' : 'error'" size="small">
                          {{ g.ok ? 'mdi-check-circle' : 'mdi-alert-circle' }}
                        </v-icon>
                      </template>
                      <v-list-item-title>{{ g.groupName || g.groupId }}</v-list-item-title>
                      <v-list-item-subtitle v-if="!g.ok" class="text-error">{{ g.error }}</v-list-item-subtitle>
                    </v-list-item>
                  </v-list>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!loading && logs.length === 0">
            <td colspan="7" class="text-center text-medium-emphasis py-8">Chưa có bài đăng nào.</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <div class="d-flex align-center justify-center mt-4 gap-2">
      <v-btn variant="text" size="small" :disabled="page <= 1" @click="changePage(-1)">‹ Trước</v-btn>
      <span class="text-body-2">Trang {{ page }}/{{ totalPages }} ({{ total }} bài)</span>
      <v-btn variant="text" size="small" :disabled="page >= totalPages" @click="changePage(1)">Sau ›</v-btn>
    </div>
  </v-container>
</template>

<style scoped>
.content-pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  margin-top: 4px;
}
.gap-2 { gap: 8px; }
</style>
