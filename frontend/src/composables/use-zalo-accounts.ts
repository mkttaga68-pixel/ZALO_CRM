/**
 * Composable for Zalo account management logic:
 * - CRUD operations via REST API
 * - Real-time QR login flow via Socket.IO
 */
import { ref, onUnmounted } from 'vue';
import { api } from '@/api/index';
import type { Socket } from 'socket.io-client';
import { connectSocket } from '@/api/socket';
import { useToast } from '@/composables/use-toast';

export interface ZaloAccount {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  zaloUid: string | null;
  status: string;
  liveStatus?: string;
  phone: string | null;
  sessionData: any;
  ownerUserId: string;
  createdAt: string;
  proxyUrl?: string | null; // masked by backend
  hasProxy?: boolean;
}

export function useZaloAccounts() {
  const accounts = ref<ZaloAccount[]>([]);
  const loading = ref(false);
  const adding = ref(false);
  const deleting = ref(false);

  // QR dialog state
  const showQRDialog = ref(false);
  const qrImage = ref('');
  const qrScanned = ref(false);
  const scannedName = ref('');
  const qrError = ref('');
  const currentLoginAccountId = ref('');

  let socket: Socket | null = null;

  const toast = useToast();

  // API /reconnect trả 200 ngay lập tức rồi mới thử login ngầm — kết quả thật về sau
  // 1-3s qua socket. Không có set này thì mọi phản hồi (kể cả THẤT BẠI) đều im lặng,
  // người dùng tưởng nút hỏng. Chỉ báo cho nick do người dùng tự bấm, để lúc app khởi
  // động lại 8-10 nick tự connect không bắn ra một loạt toast.
  const manualReconnects = new Set<string>();

  function nameOf(accountId: string): string {
    return accounts.value.find(a => a.id === accountId)?.displayName || 'Nick Zalo';
  }

  function statusColor(status: string) {
    switch (status) {
      case 'connected': return 'success';
      case 'qr_pending': case 'connecting': return 'warning';
      default: return 'error';
    }
  }

  function statusText(status: string) {
    switch (status) {
      case 'connected': return 'Đã kết nối';
      case 'qr_pending': return 'Chờ QR';
      case 'connecting': return 'Đang kết nối...';
      default: return 'Ngắt kết nối';
    }
  }

  async function fetchAccounts() {
    loading.value = true;
    try {
      const res = await api.get('/zalo-accounts');
      accounts.value = res.data;
    } catch (err) {
      console.error('Failed to fetch accounts:', err);
    } finally {
      loading.value = false;
    }
  }

  async function addAccount(displayName: string, proxyUrl?: string) {
    adding.value = true;
    try {
      await api.post('/zalo-accounts', {
        displayName: displayName || undefined,
        proxyUrl: proxyUrl?.trim() || undefined,
      });
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Failed to add account:', err);
      return false;
    } finally {
      adding.value = false;
    }
  }

  async function updateProxy(accountId: string, proxyUrl: string | null) {
    try {
      await api.put(`/zalo-accounts/${accountId}/proxy`, { proxyUrl: proxyUrl?.trim() || null });
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Update proxy failed:', err);
      return false;
    }
  }

  async function loginAccount(accountId: string) {
    currentLoginAccountId.value = accountId;
    qrImage.value = '';
    qrScanned.value = false;
    scannedName.value = '';
    qrError.value = '';
    showQRDialog.value = true;
    socket?.emit('zalo:subscribe', { accountId });
    try {
      await api.post(`/zalo-accounts/${accountId}/login`);
    } catch (err: any) {
      qrError.value = err.response?.data?.error || 'Không thể bắt đầu đăng nhập';
    }
  }

  async function reconnectAccount(accountId: string) {
    try {
      await api.post(`/zalo-accounts/${accountId}/reconnect`);
      manualReconnects.add(accountId);
      // Chuỗi thử của backend có thể kéo dài; 90s là quá đủ cho 1 lượt login.
      setTimeout(() => manualReconnects.delete(accountId), 90_000);
      toast.push(`Đang kết nối lại "${nameOf(accountId)}"...`);
      await fetchAccounts();
    } catch (err: any) {
      console.error('Reconnect failed:', err);
      const serverMsg = err?.response?.data?.error;
      toast.error(
        serverMsg === 'No saved session — please login with QR first'
          ? `"${nameOf(accountId)}" chưa có phiên đăng nhập nào — hãy bấm "Đăng nhập QR".`
          : `Không gửi được lệnh kết nối lại: ${serverMsg || err?.message || 'lỗi không rõ'}`,
        5000,
      );
    }
  }

  async function deleteAccount(account: ZaloAccount) {
    deleting.value = true;
    try {
      await api.delete(`/zalo-accounts/${account.id}`);
      await fetchAccounts();
      return true;
    } catch (err: any) {
      console.error('Delete failed:', err);
      return false;
    } finally {
      deleting.value = false;
    }
  }

  function cancelQR() {
    showQRDialog.value = false;
    socket?.emit('zalo:unsubscribe', { accountId: currentLoginAccountId.value });
  }

  let onStatusChangeCb: (() => void) | null = null;

  function onStatusChange(cb: () => void) {
    onStatusChangeCb = cb;
  }

  function setupSocket() {
    socket = connectSocket();

    socket.on('zalo:qr', (data: { accountId: string; qrImage: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrImage.value = data.qrImage;
    });

    socket.on('zalo:scanned', (data: { accountId: string; displayName: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrScanned.value = true;
        scannedName.value = data.displayName;
      }
    });

    socket.on('zalo:connected', (data: { accountId: string }) => {
      showQRDialog.value = false;
      if (manualReconnects.delete(data.accountId)) {
        toast.success(`Đã kết nối lại "${nameOf(data.accountId)}".`);
      }
      fetchAccounts();
      onStatusChangeCb?.();
    });

    socket.on('zalo:disconnected', (_data: { accountId: string }) => {
      fetchAccounts();
      onStatusChangeCb?.();
    });

    socket.on('zalo:error', (data: { accountId: string; error: string }) => {
      if (data.accountId === currentLoginAccountId.value) qrError.value = data.error;
      fetchAccounts();
      onStatusChangeCb?.();
    });

    socket.on('zalo:qr-expired', (data: { accountId: string }) => {
      if (data.accountId === currentLoginAccountId.value) {
        qrImage.value = '';
        qrError.value = 'QR đã hết hạn, đang tạo lại...';
      }
    });

    socket.on('zalo:reconnect-failed', (data: { accountId: string }) => {
      if (manualReconnects.delete(data.accountId)) {
        // Login bằng cookie đã lưu mà hỏng thì gần như luôn là phiên hết hạn/bị Zalo
        // thu hồi — bấm Reconnect thêm lần nữa cũng vô ích, phải quét QR lại.
        toast.error(
          `"${nameOf(data.accountId)}" kết nối lại thất bại — phiên Zalo đã hết hạn. Hãy bấm "Đăng nhập QR" để quét lại.`,
          6000,
        );
      }
      fetchAccounts();
      onStatusChangeCb?.();
    });
  }

  onUnmounted(() => { socket?.disconnect(); });

  return {
    accounts, loading, adding, deleting,
    showQRDialog, qrImage, qrScanned, scannedName, qrError,
    statusColor, statusText,
    fetchAccounts, addAccount, loginAccount, reconnectAccount, deleteAccount,
    updateProxy, cancelQR, setupSocket, onStatusChange,
  };
}
