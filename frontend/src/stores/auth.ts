import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { api } from '@/api/index';
import { refreshOrgTimezone } from '@/composables/use-org-timezone';

interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  orgId: string;
  orgName: string;
  orgTimezone?: string;
  grants: Record<string, Record<string, boolean>>;
}

const TOKEN_KEY = 'token';

// Đọc token từ localStorage (ghi nhớ) HOẶC sessionStorage (phiên tạm).
function readToken(): string {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
}

// Lưu token: remember=true → localStorage (bền qua lần mở sau);
// remember=false → sessionStorage (mất khi đóng trình duyệt).
function persistToken(value: string, remember: boolean): void {
  if (remember) {
    localStorage.setItem(TOKEN_KEY, value);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, value);
    localStorage.removeItem(TOKEN_KEY);
  }
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const token = ref(readToken());
  const needsSetup = ref(false);
  const profileError = ref('');
  let profileRequest = 0;

  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const isOwner = computed(() => user.value?.role === 'owner');
  const isAdmin = computed(() => ['owner', 'admin'].includes(user.value?.role || ''));
  // Module gate — mirror của RESOURCE_MODULE ở backend (permission-types.ts).
  // Tab 🤖 Bot-Auto có công tắc tổng 'bot_auto': tắt nó là 5 resource con tắt theo.
  // Phải lặp lại luật này ở FE để menu/route guard khớp với 403 của BE.
  const RESOURCE_MODULE: Record<string, string> = {
    customer_list: 'bot_auto',
    broadcast: 'bot_auto',
    sequence: 'bot_auto',
    trigger: 'bot_auto',
    block: 'bot_auto',
  };
  const hasGrant = (resource: string, action = 'access') => {
    if (isOwner.value) return true;
    if (user.value?.grants?.[resource]?.[action] !== true) return false;
    const moduleResource = RESOURCE_MODULE[resource];
    if (moduleResource && user.value?.grants?.[moduleResource]?.access !== true) return false;
    return true;
  };

  async function checkSetup() {
    const res = await api.get('/setup/status');
    needsSetup.value = res.data.needsSetup;
    return res.data.needsSetup;
  }

  async function setup(data: { orgName: string; fullName: string; email: string; password: string }) {
    const res = await api.post('/setup', data);
    token.value = res.data.token;
    user.value = res.data.user;
    persistToken(res.data.token, true);
  }

  // identifier = email HOẶC số điện thoại. remember=true → ghi nhớ đăng nhập.
  async function login(identifier: string, password: string, remember = true) {
    const res = await api.post('/auth/login', { identifier, password });
    token.value = res.data.token;
    user.value = null; // Do not expose grants until the current profile is verified.
    persistToken(res.data.token, remember);
    await fetchProfile();
    if (!user.value || !token.value) throw new Error('Không thể xác minh phiên đăng nhập');
  }

  async function fetchProfile() {
    const requestId = ++profileRequest;
    const requestToken = token.value;
    profileError.value = '';
    try {
      const res = await api.get('/profile');
      if (requestId !== profileRequest || token.value !== requestToken) return;
      const data = res.data;
      const tz = data.org?.timezone ?? '+07:00';
      user.value = {
        id: data.id,
        email: data.email,
        fullName: data.fullName,
        role: data.role,
        orgId: data.orgId,
        orgName: data.org?.name ?? '',
        orgTimezone: tz,
        grants: data.grants ?? {},
      };
      refreshOrgTimezone(tz);
    } catch (error) {
      if (requestId !== profileRequest || token.value !== requestToken) return;
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      if (status === 401) logout();
      else profileError.value = 'Tạm thời không thể xác minh phiên đăng nhập. Phiên đã được giữ lại; vui lòng thử lại hoặc tải lại trang.';
      throw error;
    }
  }

  function logout() {
    ++profileRequest;
    token.value = '';
    user.value = null;
    profileError.value = '';
    clearToken();
  }

  async function init() {
    if (token.value) {
      await fetchProfile();
    }
  }

  return { user, token, needsSetup, profileError, isAuthenticated, isOwner, isAdmin, hasGrant, checkSetup, setup, login, fetchProfile, logout, init };
});
