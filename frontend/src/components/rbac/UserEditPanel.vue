<template>
  <Transition name="panel-slide">
    <div v-if="open" class="panel-backdrop" @click.self="$emit('close')">
      <aside class="panel">
        <header class="panel-head">
          <div class="head-left">
            <span class="card-avatar-lg" :style="{ background: avatarColor(user?.fullName ?? user?.email ?? '') }">
              {{ initials(user?.fullName ?? user?.email ?? '?') }}
            </span>
            <div>
              <div class="head-eyebrow">Nhân viên</div>
              <h2 class="head-title">{{ user?.fullName || user?.email || '...' }}</h2>
            </div>
          </div>
          <button class="panel-close" @click="$emit('close')">×</button>
        </header>

        <div class="panel-body">
          <!-- ── Info section ─────────────────────── -->
          <section class="section">
            <h3 class="section-title">Thông tin</h3>
            <label class="field-label">Họ tên</label>
            <input
              v-model="localFullName"
              class="field-input"
              :disabled="!canEditInfo || busy"
              @blur="saveFullName"
              @keyup.enter="saveFullName"
            />
            <label class="field-label">Email</label>
            <input
              v-model="localEmail"
              type="email"
              class="field-input"
              :disabled="!canEditInfo || busy"
              @blur="saveEmail"
              @keyup.enter="saveEmail"
            />
            <label class="field-label">Số điện thoại đăng nhập</label>
            <input
              v-model="localPhone"
              class="field-input"
              placeholder="0912345678 — để trống nếu không dùng"
              :disabled="!canEditInfo || busy"
              @blur="savePhone"
              @keyup.enter="savePhone"
            />
            <p class="hint-soft" style="margin-top:4px">
              Nhân viên có thể đăng nhập bằng SĐT này thay cho email.
            </p>

            <template v-if="canEditRole">
              <label class="field-label">Vai trò</label>
              <select v-model="localRole" class="field-input" :disabled="busy" @change="saveRole">
                <option value="member">Nhân viên</option>
                <option value="admin">Quản trị viên</option>
                <option value="owner">Chủ tổ chức</option>
              </select>
              <p class="hint-soft" style="margin-top:4px">
                Chủ tổ chức có toàn quyền, kể cả xoá nhân viên. Chỉ chủ tổ chức đổi được vai trò.
              </p>
            </template>

            <div class="info-status-row">
              <span class="role-tag" :class="user?.isActive ? 'role-deputy' : 'role-empty-tag'">
                {{ user?.isActive ? '🟢 Đang hoạt động' : '⚪ Đã vô hiệu hóa' }}
              </span>
              <span class="role-tag" :class="`role-legacy-${user?.role}`">
                {{ legacyRoleLabel(user?.role) }}
              </span>
            </div>
          </section>

          <!-- ── Đặt lại mật khẩu ───────────────── -->
          <section v-if="canResetPassword" class="section">
            <h3 class="section-title">Mật khẩu</h3>
            <label class="field-label">Đặt mật khẩu mới</label>
            <input
              v-model="newPassword"
              type="password"
              class="field-input"
              placeholder="Tối thiểu 6 ký tự"
              :disabled="busy"
              autocomplete="new-password"
            />
            <button
              class="btn-primary-sm"
              style="margin-top:8px"
              :disabled="busy || newPassword.trim().length < 6"
              @click="savePassword"
            >
              🔑 Đặt lại mật khẩu
            </button>
            <p class="hint-soft" style="margin-top:6px">
              Nhân viên sẽ đăng nhập bằng mật khẩu mới ngay. Nhớ báo lại cho họ.
            </p>
          </section>

          <!-- ── Department ──────────────────────── -->
          <section class="section">
            <h3 class="section-title">Phòng ban</h3>
            <label class="field-label">Phòng ban</label>
            <select v-model="deptIdLocal" class="field-input" :disabled="busy" @change="onDeptChange">
              <option value="">— Không thuộc phòng nào —</option>
              <option v-for="d in flatDepts" :key="d.id" :value="d.id">
                {{ '— '.repeat(d._depth) }}{{ d.name }}
              </option>
            </select>
            <label v-if="deptIdLocal" class="field-label">Vai trò trong phòng</label>
            <select
              v-if="deptIdLocal"
              v-model="deptRoleLocal"
              class="field-input"
              :disabled="busy"
              @change="onDeptRoleChange"
            >
              <option value="member">👤 Nhân viên</option>
              <option value="deputy">🎖️ Phó phòng</option>
              <option value="leader">👑 Trưởng phòng</option>
            </select>
            <p v-if="deptIdLocal" class="hint-soft">
              <strong>Lưu ý:</strong> Mỗi phòng chỉ có 1 Trưởng phòng + 1 Phó phòng. Nếu vị trí đã có người giữ, bạn phải bỏ chức vụ của họ trước (tại trang Sơ đồ tổ chức) rồi mới gán cho người khác.
            </p>
          </section>

          <!-- ── Permission group ──────────────────── -->
          <section class="section">
            <h3 class="section-title">Nhóm quyền</h3>
            <label class="field-label">Gán nhóm quyền</label>
            <select v-model="pgIdLocal" class="field-input" :disabled="busy" @change="onPgChange">
              <option value="">— Chưa gán —</option>
              <option v-for="g in flatGroups" :key="g.id" :value="g.id">
                {{ '— '.repeat(g._depth) }}{{ g.name }}{{ g.isSystem ? ' (hệ thống)' : '' }}
              </option>
            </select>
            <div v-if="currentGroup" class="group-preview">
              <div class="preview-head">
                <span class="role-tag role-leader">🛡 {{ currentGroup.name }}</span>
                <span class="preview-stat">{{ activeGrantsCount }} quyền active</span>
              </div>
              <p class="preview-desc">
                Xem chi tiết quyền của nhóm này tại
                <RouterLink class="link" to="/settings/rbac/permission-groups">Phân quyền</RouterLink>.
              </p>
            </div>
          </section>

          <!-- ── Nicks owned ─────────────────────── -->
          <section class="section">
            <div class="section-title-row">
              <h3 class="section-title">Nick Zalo sở hữu ({{ ownedNicks.length }})</h3>
            </div>
            <ul v-if="ownedNicks.length" class="member-list">
              <li v-for="n in ownedNicks" :key="n.id" class="member-row">
                <span class="member-avatar" :style="{ background: avatarColor(n.displayName || 'Nick') }">
                  {{ initials(n.displayName || 'Nick') }}
                </span>
                <div class="member-info">
                  <div class="member-name">{{ n.displayName || '(chưa đặt tên)' }}</div>
                  <div class="member-email">{{ n.phone || n.zaloUid || '—' }} · {{ statusLabel(n.status) }}</div>
                </div>
                <span class="member-role-tag role-tag-leader">Owner</span>
              </li>
            </ul>
            <div v-else class="empty-members">
              User này chưa sở hữu nick Zalo nào.
            </div>
            <p class="hint-soft">
              Quản lý quyền truy cập nick khác qua trang
              <RouterLink class="link" to="/zalo-accounts">Nick Zalo</RouterLink>.
            </p>
          </section>

          <!-- ── Cấu hình Riêng tư — Phase Privacy v2 2026-05-23 ── -->
          <section class="section">
            <h3 class="section-title">Cấu hình Riêng tư</h3>
            <label class="field-label">Max nick riêng tư</label>
            <select v-model="maxPrivacyLocal" class="field-input" :disabled="busy" @change="onMaxPrivacyChange">
              <option v-for="n in 10" :key="n" :value="n">{{ n }} nick</option>
            </select>
            <p class="hint-soft" style="margin-top:6px">
              User được phép đánh dấu tối đa N nick là "Riêng tư". Default = 2.
              Vượt giới hạn → BE reject với message "liên hệ admin". Cho phép 1-10.
            </p>
          </section>

          <!-- ── Danger zone ─────────────────────── -->
          <section v-if="canDeactivate" class="section section-danger">
            <h3 class="section-title danger-title">Vùng nguy hiểm</h3>
            <p class="danger-desc" v-if="user?.isActive">
              Vô hiệu hóa user — user sẽ không thể đăng nhập. Có thể khôi phục sau bằng cách kích hoạt lại từ DB.
            </p>
            <p class="danger-desc" v-else>
              User đang ở trạng thái <strong>vô hiệu hóa</strong>. Nhấn 'Kích hoạt lại' để cho phép đăng nhập.
            </p>
            <button
              v-if="user?.isActive"
              class="btn-danger"
              :disabled="busy"
              @click="confirmDeactivate"
            >
              🚫 Vô hiệu hóa user
            </button>
            <button v-else class="btn-primary-sm" :disabled="busy" @click="confirmReactivate">
              ✓ Kích hoạt lại
            </button>

            <hr class="dz-sep" />

            <p class="danger-desc">
              <strong>Xoá vĩnh viễn</strong> — gỡ hẳn tài khoản khỏi hệ thống, không khôi phục được.
              Nick Zalo, ghi chú và kịch bản của họ sẽ được <strong>bàn giao</strong> sang người khác,
              không mất dữ liệu khách hàng.
            </p>
            <button class="btn-danger" :disabled="busy" @click="openDeleteDialog">
              🗑 Xoá vĩnh viễn khỏi hệ thống
            </button>
          </section>
        </div>

        <p v-if="error" class="panel-error">{{ error }}</p>
      </aside>

      <!-- Hộp xác nhận xoá vĩnh viễn + bàn giao -->
      <div v-if="deletePreview" class="del-overlay" @click.self="closeDeleteDialog">
        <div class="del-dialog">
          <h3 class="del-title">Xoá vĩnh viễn {{ deletePreview.user.fullName || deletePreview.user.email }}?</h3>

          <p class="del-lead">
            Tài khoản sẽ bị gỡ khỏi hệ thống, <strong>không khôi phục được</strong>.
          </p>

          <template v-if="deletePreview.blockerTotal > 0">
            <div class="del-block">
              <div class="del-block-head">Phải bàn giao trước khi xoá</div>
              <ul class="del-list">
                <li v-if="deletePreview.blockers.zaloAccounts">
                  <strong>{{ deletePreview.blockers.zaloAccounts }}</strong> nick Zalo (kèm KH đang chăm)
                </li>
                <li v-if="deletePreview.blockers.notes">
                  <strong>{{ deletePreview.blockers.notes }}</strong> ghi chú
                </li>
                <li v-if="deletePreview.blockers.blocks || deletePreview.blockers.blockFolders">
                  <strong>{{ deletePreview.blockers.blocks + deletePreview.blockers.blockFolders }}</strong> khối nội dung
                </li>
                <li v-if="deletePreview.blockers.sequences || deletePreview.blockers.triggers || deletePreview.blockers.broadcasts">
                  <strong>{{ deletePreview.blockers.sequences + deletePreview.blockers.triggers + deletePreview.blockers.broadcasts }}</strong>
                  kịch bản / trigger / chiến dịch
                </li>
              </ul>
            </div>

            <label class="field-label">Bàn giao cho *</label>
            <select v-model="transferToId" class="field-input" :disabled="busy">
              <option value="">— Chọn nhân viên nhận —</option>
              <option v-for="c in deletePreview.transferCandidates" :key="c.id" :value="c.id">
                {{ c.fullName || c.email }} ({{ legacyRoleLabel(c.role) }})
              </option>
            </select>
            <p v-if="deletePreview.transferCandidates.length === 0" class="del-warn">
              Không còn nhân viên nào đang hoạt động để nhận bàn giao. Hãy tạo hoặc kích hoạt một
              tài khoản khác trước.
            </p>
          </template>
          <p v-else class="del-ok">
            Nhân viên này không sở hữu nick Zalo / ghi chú / kịch bản nào — xoá thẳng được.
          </p>

          <p v-if="deletePreview.unlinked.assignedContacts || deletePreview.unlinked.appointments" class="del-soft">
            {{ deletePreview.unlinked.assignedContacts }} KH và
            {{ deletePreview.unlinked.appointments }} lịch hẹn đang gán cho họ sẽ chuyển thành
            <em>chưa có người phụ trách</em> — dữ liệu vẫn còn nguyên.
          </p>

          <p v-if="deleteError" class="del-error">{{ deleteError }}</p>

          <div class="del-actions">
            <button class="btn-ghost" :disabled="busy" @click="closeDeleteDialog">Huỷ</button>
            <button class="btn-danger" :disabled="busy || !canConfirmDelete" @click="confirmHardDelete">
              {{ busy ? 'Đang xoá…' : 'Xoá vĩnh viễn' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  useRbacStore,
  type RbacUser,
  type DepartmentNode,
  type PermissionGroupNode,
} from '@/stores/rbac';
import { api } from '@/api/index';

interface OwnedNick {
  id: string;
  displayName: string | null;
  phone: string | null;
  status: string;
  zaloUid: string | null;
}

const props = defineProps<{
  open: boolean;
  user: RbacUser | null;
  currentUserId: string;
  currentUserRole: string;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();

const store = useRbacStore();
const busy = ref(false);
const error = ref('');

const localFullName = ref('');
const localEmail = ref('');
const localPhone = ref('');
const localRole = ref<'member' | 'admin' | 'owner'>('member');
const newPassword = ref('');

// Xoá vĩnh viễn + bàn giao
interface DeletionPreview {
  user: { id: string; fullName: string; email: string; role: string; isActive: boolean };
  blockers: {
    zaloAccounts: number; notes: number; blocks: number; blockFolders: number;
    sequences: number; triggers: number; broadcasts: number;
  };
  blockerTotal: number;
  unlinked: { assignedContacts: number; appointments: number };
  transferCandidates: Array<{ id: string; fullName: string; email: string; role: string }>;
}
const deletePreview = ref<DeletionPreview | null>(null);
const transferToId = ref('');
const deleteError = ref('');
const deptIdLocal = ref<string>('');
const deptRoleLocal = ref<'leader' | 'deputy' | 'member'>('member');
const pgIdLocal = ref<string>('');
const ownedNicks = ref<OwnedNick[]>([]);
// Phase Privacy v2 2026-05-23
const maxPrivacyLocal = ref<number>(2);

const canEditInfo = computed(() => {
  const u = props.user;
  if (!u) return false;
  // Owner edits self always; owner/admin edits anyone
  if (u.id === props.currentUserId) return true;
  return ['owner', 'admin'].includes(props.currentUserRole);
});
const canDeactivate = computed(() => {
  return props.currentUserRole === 'owner' && props.user?.id !== props.currentUserId;
});

// Chỉ chủ tổ chức đổi được vai trò, và không đổi vai trò của chính mình
// (tránh tự hạ quyền rồi kẹt ngoài hệ thống).
const canEditRole = computed(
  () => props.currentUserRole === 'owner' && props.user?.id !== props.currentUserId,
);
// Đặt lại mật khẩu: owner/admin — khớp quyền của endpoint BE.
const canResetPassword = computed(() => ['owner', 'admin'].includes(props.currentUserRole));

const canConfirmDelete = computed(() => {
  const p = deletePreview.value;
  if (!p) return false;
  return p.blockerTotal === 0 || !!transferToId.value;
});

const flatDepts = computed(() => {
  const out: Array<DepartmentNode & { _depth: number }> = [];
  function walk(nodes: DepartmentNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.departments, 0);
  return out;
});
const flatGroups = computed(() => {
  const out: Array<PermissionGroupNode & { _depth: number }> = [];
  function walk(nodes: PermissionGroupNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.permissionGroups, 0);
  return out;
});

const currentGroup = computed(() =>
  pgIdLocal.value ? flatGroups.value.find((g) => g.id === pgIdLocal.value) : null
);
const activeGrantsCount = computed(() => {
  const grp = currentGroup.value;
  if (!grp || !store.matrixMeta) return 0;
  let n = 0;
  for (const r of store.matrixMeta.resources) {
    for (const a of store.matrixMeta.resourceActions[r] ?? []) {
      if (grp.grants[r]?.[a]) n++;
    }
  }
  return n;
});

watch(
  () => [props.open, props.user?.id],
  async () => {
    if (!props.open || !props.user) return;
    localFullName.value = props.user.fullName ?? '';
    localEmail.value = props.user.email ?? '';
    localPhone.value = (props.user as any).phone ?? '';
    localRole.value = ((props.user.role as any) ?? 'member');
    newPassword.value = '';
    deletePreview.value = null;
    transferToId.value = '';
    deleteError.value = '';
    deptIdLocal.value = props.user.departmentMember?.departmentId ?? '';
    deptRoleLocal.value = props.user.departmentMember?.deptRole ?? 'member';
    pgIdLocal.value = props.user.permissionGroupId ?? '';
    maxPrivacyLocal.value = (props.user as any).maxPrivacyNicks ?? 2;
    error.value = '';
    ownedNicks.value = [];
    // Load owned nicks
    try {
      const { data } = await api.get('/zalo-accounts');
      const all: any[] = Array.isArray(data) ? data : data.accounts ?? [];
      ownedNicks.value = all
        .filter((a) => a.owner?.id === props.user!.id || a.ownerUserId === props.user!.id)
        .map((a) => ({
          id: a.id,
          displayName: a.displayName,
          phone: a.phone,
          status: a.liveStatus || a.status,
          zaloUid: a.zaloUid,
        }));
    } catch {
      ownedNicks.value = [];
    }
  },
  { immediate: true }
);

async function saveFullName() {
  if (!props.user || !canEditInfo.value) return;
  const trimmed = localFullName.value.trim();
  if (!trimmed || trimmed === props.user.fullName) return;
  busy.value = true;
  try {
    await api.put(`/users/${props.user.id}`, { fullName: trimmed });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi họ tên';
    localFullName.value = props.user.fullName;
  } finally {
    busy.value = false;
  }
}

async function saveEmail() {
  if (!props.user || !canEditInfo.value) return;
  const trimmed = localEmail.value.trim();
  if (!trimmed || trimmed === props.user.email) return;
  busy.value = true;
  try {
    await api.put(`/users/${props.user.id}`, { email: trimmed });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi email';
    localEmail.value = props.user.email;
  } finally {
    busy.value = false;
  }
}

async function savePhone() {
  if (!props.user || !canEditInfo.value) return;
  const trimmed = localPhone.value.trim();
  const current = ((props.user as any).phone ?? '') as string;
  if (trimmed === current) return;
  busy.value = true;
  error.value = '';
  try {
    // Chuỗi rỗng = gỡ SĐT đăng nhập. BE tự chuẩn hoá 0xxx / +84xxx → 84xxx.
    await api.put(`/users/${props.user.id}`, { phone: trimmed });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi số điện thoại';
    localPhone.value = current;
  } finally {
    busy.value = false;
  }
}

async function saveRole() {
  if (!props.user || !canEditRole.value) return;
  const current = props.user.role;
  if (localRole.value === current) return;
  busy.value = true;
  error.value = '';
  try {
    await api.put(`/users/${props.user.id}`, { role: localRole.value });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi vai trò';
    localRole.value = current as any;
  } finally {
    busy.value = false;
  }
}

async function savePassword() {
  if (!props.user || !canResetPassword.value) return;
  const pw = newPassword.value.trim();
  if (pw.length < 6) {
    error.value = 'Mật khẩu tối thiểu 6 ký tự';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await api.put(`/users/${props.user.id}/password`, { password: pw });
    newPassword.value = '';
    error.value = '';
    alert('Đã đặt lại mật khẩu. Nhớ báo mật khẩu mới cho nhân viên.');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đặt lại mật khẩu';
  } finally {
    busy.value = false;
  }
}

// ── Xoá vĩnh viễn ─────────────────────────────────────────────────────────
// Luôn hỏi BE trước xem cần bàn giao gì: nick Zalo / ghi chú / kịch bản đều là
// khoá ngoại bắt buộc, không chuyển chủ thì lệnh xoá sẽ fail.
async function openDeleteDialog() {
  if (!props.user) return;
  busy.value = true;
  deleteError.value = '';
  try {
    const { data } = await api.get(`/users/${props.user.id}/deletion-preview`);
    deletePreview.value = data.preview;
    transferToId.value = '';
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Không tải được thông tin xoá';
  } finally {
    busy.value = false;
  }
}

function closeDeleteDialog() {
  deletePreview.value = null;
  transferToId.value = '';
  deleteError.value = '';
}

async function confirmHardDelete() {
  if (!props.user || !canConfirmDelete.value) return;
  busy.value = true;
  deleteError.value = '';
  try {
    const params = new URLSearchParams({ mode: 'hard' });
    if (transferToId.value) params.set('transferToUserId', transferToId.value);
    await api.delete(`/users/${props.user.id}?${params.toString()}`);
    closeDeleteDialog();
    emit('changed');
    emit('close');
  } catch (e: any) {
    deleteError.value = e?.response?.data?.error || 'Không xoá được nhân viên';
  } finally {
    busy.value = false;
  }
}

async function onDeptChange() {
  if (!props.user) return;
  // Empty = remove from current dept (no API support for explicit remove without endpoint).
  // Workaround: if user had a dept and selected '' → call DELETE on /departments/:old/members/:userId
  const oldDeptId = props.user.departmentMember?.departmentId;
  busy.value = true;
  try {
    if (!deptIdLocal.value && oldDeptId) {
      await api.delete(`/departments/${oldDeptId}/members/${props.user.id}`);
      await store.loadUsers();
      emit('changed');
    } else if (deptIdLocal.value) {
      await store.assignMember(deptIdLocal.value, props.user.id, deptRoleLocal.value);
      emit('changed');
    }
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi phòng ban';
  } finally {
    busy.value = false;
  }
}

async function onDeptRoleChange() {
  if (!props.user || !deptIdLocal.value) return;
  busy.value = true;
  try {
    await store.assignMember(deptIdLocal.value, props.user.id, deptRoleLocal.value);
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi chức vụ';
  } finally {
    busy.value = false;
  }
}

async function onPgChange() {
  if (!props.user) return;
  busy.value = true;
  try {
    await store.setUserPermissionGroup(props.user.id, pgIdLocal.value || null);
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi nhóm quyền';
  } finally {
    busy.value = false;
  }
}

// Phase Privacy v2 2026-05-23
async function onMaxPrivacyChange() {
  if (!props.user) return;
  busy.value = true;
  error.value = '';
  try {
    await api.patch(`/users/${props.user.id}/max-privacy-nicks`, { maxPrivacyNicks: maxPrivacyLocal.value });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi maxPrivacyNicks';
    maxPrivacyLocal.value = (props.user as any).maxPrivacyNicks ?? 2;
  } finally {
    busy.value = false;
  }
}

async function confirmDeactivate() {
  if (!props.user) return;
  if (!confirm(`Vô hiệu hóa user "${props.user.fullName || props.user.email}"? User sẽ không đăng nhập được.`)) return;
  busy.value = true;
  try {
    await api.delete(`/users/${props.user.id}`);
    emit('changed');
    emit('close');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi vô hiệu hóa';
  } finally {
    busy.value = false;
  }
}

async function confirmReactivate() {
  if (!props.user) return;
  busy.value = true;
  try {
    await api.put(`/users/${props.user.id}`, { isActive: true });
    emit('changed');
    emit('close');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi kích hoạt';
  } finally {
    busy.value = false;
  }
}

function legacyRoleLabel(r?: string) {
  return r === 'owner' ? 'Chủ tổ chức' : r === 'admin' ? 'Quản trị' : 'Thành viên';
}

function statusLabel(s: string): string {
  if (s === 'connected') return '🟢 Đã kết nối';
  if (s === 'disconnected') return '⚪ Ngắt';
  if (s === 'qr_pending') return '🟡 Chờ QR';
  return s;
}

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style>
.info-status-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.role-empty-tag { background: #f0f1f3; color: #6b7280; }
.role-legacy-owner { background: #fdf3df; color: #7a5818; }
.role-legacy-admin { background: #e3ede4; color: #0a2e0e; }
.role-legacy-member { background: #f0f1f3; color: #41454d; }

.hint-soft {
  margin-top: 10px;
  font-size: 11px;
  color: #41454d;
  background: #f8fafc;
  border-left: 3px solid #d6d8dc;
  padding: 8px 12px;
  border-radius: 6px;
  line-height: 1.45;
}
.hint-soft strong { color: #181d26; }
.link { color: #1b61c9; text-decoration: none; font-weight: 500; }
.link:hover { text-decoration: underline; }

.group-preview {
  margin-top: 12px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e0e2e6;
  border-radius: 8px;
}
.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 8px;
  flex-wrap: wrap;
}
.preview-stat {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 9999px;
  background: #e3ede4;
  color: #0a2e0e;
}
.preview-desc { font-size: 11px; color: #41454d; margin: 0; line-height: 1.5; }

/* ── Hộp xác nhận xoá vĩnh viễn ── */
.dz-sep { border: 0; border-top: 1px solid #f5cdb3; margin: 14px 0 12px; }

.del-overlay {
  position: fixed; inset: 0; background: rgba(17, 24, 39, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 1300;
}
.del-dialog {
  background: white; border-radius: 12px; padding: 20px 22px;
  width: 460px; max-width: 92vw; max-height: 88vh; overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0,0,0,0.2);
}
.del-title { margin: 0 0 10px; font-size: 16px; font-weight: 700; color: #991b1b; }
.del-lead { font-size: 13px; color: #1f2937; line-height: 1.6; margin: 0 0 12px; }
.del-block {
  background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 8px; padding: 10px 13px; margin-bottom: 13px;
}
.del-block-head {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.6px; color: #991b1b; margin-bottom: 6px;
}
.del-list { margin: 0; padding-left: 18px; font-size: 12.5px; color: #7f1d1d; line-height: 1.75; }
.del-ok {
  background: #e3ede4; border: 1px solid #c8d8c9; color: #0a2e0e;
  border-radius: 8px; padding: 9px 12px; font-size: 12.5px;
  line-height: 1.55; margin: 0 0 13px;
}
.del-soft { font-size: 12px; color: #6b7280; line-height: 1.6; margin: 10px 0 0; }
.del-warn { font-size: 12px; color: #aa2d00; line-height: 1.55; margin: 8px 0 0; }
.del-error {
  background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
  border-radius: 7px; padding: 8px 11px; font-size: 12.5px; margin: 11px 0 0;
}
.del-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
</style>
