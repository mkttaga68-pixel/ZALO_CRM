<!--
  Chuông cảnh báo AI QC toàn CRM cho người phụ trách phòng ban.
  - Nhận gợi ý realtime (không chứa nội dung) qua namespace /aiqc-observers, rồi gọi API
    /department-observations — API này kiểm lại quyền, người nhận và ACL hội thoại.
  - Không có socket (worker liên tục chưa bật) thì vẫn hoạt động bằng polling 60 giây.
  - Cảnh báo mới: hiện toast trong CRM, phát tiếng ngắn, và thông báo trên máy khi tab ẩn
    (nếu người dùng đã cho phép).
-->
<template>
  <template v-if="available">
    <v-menu v-model="menu" :close-on-content-click="false" max-width="400" location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn icon variant="text" v-bind="menuProps" class="mr-1" :title="'Cảnh báo AI' + (unread ? ` (${unread} mới)` : '')" aria-label="Cảnh báo AI">
          <v-badge :content="unread > 99 ? '99+' : unread" :model-value="unread > 0" color="warning" overlap>
            <v-icon>mdi-shield-alert-outline</v-icon>
          </v-badge>
        </v-btn>
      </template>
      <v-card class="aiqc-alert-card">
        <div class="aiqc-alert-head">
          <div>
            <strong>Cảnh báo AI phòng ban</strong>
            <div class="aiqc-alert-sub">
              <span :class="['aiqc-dot', { live: connected }]" />{{ connected ? 'Đang nhận trực tiếp' : 'Tự cập nhật mỗi phút' }}
            </div>
          </div>
          <v-btn size="small" variant="text" :loading="busy" @click="load(true)">Làm mới</v-btn>
        </div>
        <v-divider />
        <div v-if="desktopPermission === 'default'" class="aiqc-alert-permission">
          <span>Nhận thông báo cả khi đang ở tab khác.</span>
          <v-btn size="x-small" variant="tonal" color="primary" @click="askDesktopPermission">Bật</v-btn>
        </div>
        <v-list v-if="items.length" density="compact" class="aiqc-alert-list">
          <v-list-item v-for="item in items.slice(0, 15)" :key="item.id" class="py-2" @click="openItem(item.id)">
            <template #prepend>
              <v-icon :color="item.unread ? 'warning' : 'grey'" size="20">{{ item.unread ? 'mdi-alert' : 'mdi-alert-outline' }}</v-icon>
            </template>
            <v-list-item-title :class="['text-body-2', { 'font-weight-bold': item.unread }]">{{ employeeText(item) }}</v-list-item-title>
            <v-list-item-subtitle class="text-caption">{{ typeText(item) }} · {{ time(item.createdAt) }}</v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <div v-else class="pa-4 text-center text-caption text-grey">Chưa có cảnh báo trong phạm vi của bạn</div>
        <v-divider />
        <div class="pa-2 text-right">
          <v-btn size="small" variant="text" color="primary" @click="openPage()">Mở trang AI Quality Control</v-btn>
        </div>
      </v-card>
    </v-menu>

    <v-snackbar v-model="toast.show" :timeout="12000" color="warning" location="top right" multi-line>
      <div class="font-weight-bold mb-1">⚠ AI phát hiện nội dung cần xem xét</div>
      <div>{{ toast.text }}</div>
      <template #actions>
        <v-btn variant="text" @click="toast.show = false; openItem(toast.id)">Xem</v-btn>
        <v-btn variant="text" icon="mdi-close" aria-label="Đóng" @click="toast.show = false" />
      </template>
    </v-snackbar>
  </template>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { io, type Socket } from 'socket.io-client';
import { readToken } from '@/api/index';
import { qcRequest } from '@/api/ai-quality-control';
import { qcLabel } from '@/views/ai-quality-control/presentation';

import { alertText, freshAlerts, type AiqcAlertItem as Item } from './aiqc-alert-diff';

const router = useRouter();
const available = ref(true);
const items = ref<Item[]>([]);
const unread = ref(0);
const busy = ref(false);
const menu = ref(false);
const connected = ref(false);
const toast = reactive({ show: false, text: '', id: '' });
const desktopPermission = ref<NotificationPermission | 'unsupported'>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

// ID đã biết, để chỉ báo cảnh báo THẬT SỰ mới — không báo lại cả danh sách sau khi tải trang.
const known = new Set<string>();
let initialized = false;
let socket: Socket | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let active = true;

const employeeText = (item: Item) => item.employees.map(e => e.name).join(', ') || 'Hội thoại cần xem xét';
const typeText = (item: Item) => [...new Set(item.types)].map(qcLabel).join(' · ');
const time = (v: string) => new Date(v).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function load(force = false) {
  if (busy.value || (!force && document.hidden && !connected.value)) return;
  busy.value = true;
  try {
    const data = await qcRequest<{ items: Item[]; unread: number }>('get', '/department-observations');
    if (!active) return;
    const fresh = freshAlerts(known, data.items, initialized);
    items.value = data.items;
    unread.value = data.unread;
    available.value = true;
    if (fresh.length) announce(fresh);
    initialized = true;
  } catch (e) {
    const status = (e as { response?: { status?: number } }).response?.status;
    // 403/404/503: tài khoản không có quyền hoặc tính năng đang tắt — ẩn chuông, ngừng polling.
    if (status === 403 || status === 404 || status === 503) { available.value = false; stop(); }
  } finally {
    busy.value = false;
  }
}

function announce(fresh: Item[]) {
  const first = fresh[0]!;
  const text = alertText(fresh, qcLabel);
  Object.assign(toast, { show: true, text, id: first.id });
  beep();
  if (document.hidden && desktopPermission.value === 'granted') {
    try {
      const n = new Notification('Cảnh báo AI phòng ban', { body: text, tag: 'aiqc-' + first.id, icon: '/favicon.ico' });
      n.onclick = () => { window.focus(); openItem(first.id); n.close(); };
    } catch { /* Trình duyệt chặn Notification ngoài service worker: toast vẫn hiện. */ }
  }
}

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.setValueAtTime(0.08, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.35); osc.onended = () => void ctx.close();
  } catch { /* Không có âm thanh khi trình duyệt chưa cho phép autoplay. */ }
}

async function askDesktopPermission() {
  if (typeof Notification === 'undefined') return;
  desktopPermission.value = await Notification.requestPermission();
}

function openItem(id: string) {
  menu.value = false;
  void router.push({ path: '/ai-quality-control', query: { observation: id } });
}
function openPage() { menu.value = false; void router.push('/ai-quality-control'); }

function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
  socket?.disconnect();
  socket = undefined;
}

function onVisible() { if (!document.hidden) void load(); }

onMounted(() => {
  void load(true);
  timer = setInterval(() => void load(), 60000);
  socket = io('/aiqc-observers', { auth: cb => cb({ token: readToken() ?? '' }), transports: ['websocket'], reconnectionDelayMax: 30000 });
  socket.on('connect', () => { connected.value = true; void load(true); });
  socket.on('disconnect', () => { connected.value = false; });
  socket.on('aiqc:observations-changed', () => void load(true));
  document.addEventListener('visibilitychange', onVisible);
});
onUnmounted(() => { active = false; stop(); document.removeEventListener('visibilitychange', onVisible); });
</script>

<style scoped>
.aiqc-alert-card { width: 380px; max-width: calc(100vw - 32px); }
.aiqc-alert-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; gap: 8px; }
.aiqc-alert-sub { font-size: 11px; opacity: .7; margin-top: 3px; display: flex; align-items: center; gap: 6px; }
.aiqc-dot { width: 7px; height: 7px; border-radius: 50%; background: #9aa3b5; display: inline-block; }
.aiqc-dot.live { background: #2fb36d; }
.aiqc-alert-permission { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 14px; font-size: 12px; background: rgba(var(--v-theme-primary), .06); }
.aiqc-alert-list { max-height: 360px; overflow-y: auto; }
</style>
