/**
 * use-contact-purge.ts — Admin xoá dữ liệu trang Khách hàng mà 1 nhân viên vừa
 * đồng bộ vào. Bọc 4 endpoint /admin/contact-purge/*.
 *
 * Luồng bắt buộc: fetchTargets → preview → execute (gõ email xác nhận).
 * KHÔNG có đường gọi execute mà chưa preview — BE cũng chặn bằng `confirm`.
 */
import { ref } from 'vue';
import { api } from '@/api';

export interface PurgeAccount {
  id: string;
  displayName: string | null;
  zaloUid: string | null;
  status: string;
  syncPaused: boolean;
  friendCount: number;
}

export interface PurgeTargetUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  accounts: PurgeAccount[];
  totalFriends: number;
}

export interface PurgePlan {
  user: { id: string; fullName: string; email: string };
  /** Chuỗi admin phải gõ để xác nhận = email nhân viên bị xoá dữ liệu */
  confirmPhrase: string;
  accounts: PurgeAccount[];
  keepCurated: boolean;
  deleteConversations: boolean;
  counts: {
    friendsToDelete: number;
    contactsToDelete: number;
    contactsKeptSharedWithOthers: number;
    contactsKeptCurated: number;
    conversationsToDelete: number;
    messagesToDelete: number;
    appointmentsLost: number;
    notesLost: number;
  };
  sampleContactsToDelete: Array<{ id: string; fullName: string | null; phone: string | null }>;
}

export interface PurgeResult {
  friendsDeleted: number;
  contactsDeleted: number;
  contactsKept: number;
  conversationsDeleted: number;
  messagesDeleted: number;
  accountsPaused: string[];
  durationMs: number;
}

export interface PurgeScope {
  userId: string;
  zaloAccountIds?: string[];
  keepCurated: boolean;
  deleteConversations: boolean;
}

export function useContactPurge() {
  const targets = ref<PurgeTargetUser[]>([]);
  const plan = ref<PurgePlan | null>(null);
  const result = ref<PurgeResult | null>(null);
  const loading = ref(false);
  const previewing = ref(false);
  const executing = ref(false);
  const error = ref('');

  function readError(err: any, fallback: string): string {
    return err?.response?.data?.error || err?.response?.data?.message || fallback;
  }

  async function fetchTargets() {
    loading.value = true;
    error.value = '';
    try {
      const res = await api.get('/admin/contact-purge/targets');
      targets.value = res.data.targets ?? [];
    } catch (err: any) {
      error.value = readError(err, 'Lỗi tải danh sách nhân viên');
    } finally {
      loading.value = false;
    }
  }

  async function preview(scope: PurgeScope): Promise<boolean> {
    previewing.value = true;
    error.value = '';
    result.value = null;
    try {
      const res = await api.post('/admin/contact-purge/preview', scope);
      plan.value = res.data.plan;
      return true;
    } catch (err: any) {
      plan.value = null;
      error.value = readError(err, 'Lỗi tính toán dữ liệu sẽ xoá');
      return false;
    } finally {
      previewing.value = false;
    }
  }

  /** confirm phải là email của nhân viên bị xoá dữ liệu — BE đối chiếu, không chỉ FE. */
  async function execute(scope: PurgeScope, confirm: string): Promise<boolean> {
    executing.value = true;
    error.value = '';
    try {
      const res = await api.post('/admin/contact-purge/execute', { ...scope, confirm });
      result.value = res.data.result;
      await fetchTargets();
      return true;
    } catch (err: any) {
      error.value = readError(err, 'Lỗi xoá dữ liệu');
      return false;
    } finally {
      executing.value = false;
    }
  }

  async function resumeSync(zaloAccountIds: string[]): Promise<boolean> {
    error.value = '';
    try {
      await api.post('/admin/contact-purge/resume', { zaloAccountIds });
      await fetchTargets();
      return true;
    } catch (err: any) {
      error.value = readError(err, 'Lỗi bật lại đồng bộ');
      return false;
    }
  }

  function reset() {
    plan.value = null;
    result.value = null;
    error.value = '';
  }

  return {
    targets,
    plan,
    result,
    loading,
    previewing,
    executing,
    error,
    fetchTargets,
    preview,
    execute,
    resumeSync,
    reset,
  };
}
