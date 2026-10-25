<template>
  <div class="dept-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">Xoá dữ liệu KH đã đồng bộ</h1>
        <p class="hero-sub">
          Hoàn tác lần đồng bộ danh sách bạn Zalo của một nhân viên · Chọn theo nhân viên hoặc theo từng nick ·
          Xem trước số liệu rồi mới xoá
        </p>
      </div>
    </header>

    <!-- Giải thích phạm vi — đặt ngay đầu trang vì đây là thao tác không hoàn tác -->
    <div class="notice notice-info">
      <div class="notice-ico">ℹ️</div>
      <div class="notice-body">
        <strong>Chỉ xoá khỏi hệ thống CRM — KHÔNG xoá kết bạn trên Zalo.</strong>
        Nick vẫn là bạn của khách hàng trên Zalo thật. Thao tác này chỉ dọn dữ liệu trong trang Khách hàng.
        <br />
        Vì vẫn còn là bạn, hệ thống sẽ <strong>tạm dừng đồng bộ</strong> các nick trong phạm vi — nếu không,
        tác vụ tự động 15 phút sẽ hút toàn bộ khách hàng về lại. Bật lại đồng bộ bằng nút ở cột cuối bảng.
      </div>
    </div>

    <div v-if="error" class="notice notice-error">
      <div class="notice-ico">⚠️</div>
      <div class="notice-body">{{ error }}</div>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 3" :key="i" style="height: 56px"></div>
    </div>

    <div v-else-if="targets.length === 0" class="empty-state">
      <div class="empty-icon">🙂</div>
      <h3>Không có nhân viên nào có nick Zalo</h3>
      <p>Chưa có nick nào đồng bộ dữ liệu vào nên không có gì để xoá.</p>
    </div>

    <template v-else>
      <!-- BƯỚC 1 — chọn nhân viên -->
      <section class="step-block">
        <div class="step-head">
          <span class="step-badge">1</span>
          <h2 class="step-title">Chọn nhân viên</h2>
        </div>

        <div class="at-table-wrap">
          <table class="at-table">
            <thead>
              <tr>
                <th class="th-num">#</th>
                <th class="th-name">Nhân viên</th>
                <th class="th-email">Email</th>
                <th class="th-nicks">Nick Zalo</th>
                <th class="th-count">KH đã đồng bộ</th>
                <th class="th-sel"></th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(u, i) in targets"
                :key="u.id"
                :class="{ 'row-active': selectedUserId === u.id }"
                @click="selectUser(u)"
              >
                <td class="cell-num">{{ i + 1 }}</td>
                <td class="cell-name">
                  <span class="at-avatar" :style="{ background: avatarColor(u.fullName || u.email) }">
                    {{ initials(u.fullName || u.email) }}
                  </span>
                  <div class="cell-name-text">
                    <div class="cell-name-main">{{ u.fullName || '(chưa đặt tên)' }}</div>
                    <div v-if="!u.isActive" class="cell-name-sub inactive-tag">Đã vô hiệu</div>
                  </div>
                </td>
                <td class="cell-email">{{ u.email }}</td>
                <td>
                  <span class="at-chip chip-member">{{ u.accounts.length }} nick</span>
                  <span v-if="u.accounts.some((a) => a.syncPaused)" class="at-chip chip-paused">⏸ tạm dừng</span>
                </td>
                <td class="cell-strong">{{ formatNum(u.totalFriends) }}</td>
                <td class="cell-sel">
                  <span v-if="selectedUserId === u.id" class="sel-mark">✓</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- BƯỚC 2 — chọn nick + tuỳ chọn -->
      <section v-if="selectedUser" class="step-block">
        <div class="step-head">
          <span class="step-badge">2</span>
          <h2 class="step-title">Chọn nick Zalo cần xoá dữ liệu</h2>
          <button class="btn-link" @click="toggleAllNicks">
            {{ allNicksSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả' }}
          </button>
        </div>

        <div class="nick-grid">
          <label
            v-for="a in selectedUser.accounts"
            :key="a.id"
            class="nick-card"
            :class="{ 'nick-on': selectedAccountIds.includes(a.id) }"
          >
            <input type="checkbox" :value="a.id" v-model="selectedAccountIds" @change="onScopeChange" />
            <div class="nick-info">
              <div class="nick-name">{{ a.displayName || '(chưa có tên)' }}</div>
              <div class="nick-meta">
                <span class="nick-uid">{{ a.zaloUid || 'chưa có UID' }}</span>
                <span class="dot">·</span>
                <span>{{ formatNum(a.friendCount) }} KH</span>
                <span class="dot">·</span>
                <span :class="a.status === 'connected' ? 'st-on' : 'st-off'">{{ statusLabel(a.status) }}</span>
              </div>
            </div>
            <div class="nick-right">
              <span v-if="a.syncPaused" class="at-chip chip-paused">⏸ Tạm dừng</span>
              <button
                v-if="a.syncPaused"
                class="btn-quick btn-quick-add"
                :disabled="executing"
                @click.prevent.stop="onResume([a.id])"
              >
                Bật lại đồng bộ
              </button>
            </div>
          </label>
        </div>

        <div class="mode-head">Mức độ xoá</div>
        <div class="mode-grid">
          <label class="mode-card" :class="{ 'mode-on': !wipeAll }">
            <input type="radio" :value="false" v-model="wipeAll" @change="onScopeChange" />
            <div class="mode-body">
              <div class="mode-title">🛡 Xoá an toàn <span class="mode-rec">(mặc định)</span></div>
              <div class="mode-desc">
                Cắt liên kết nick ↔ KH, xoá KH không còn nick nào chăm.
                <strong>Giữ lại</strong> KH đã chăm thật (có SĐT, ghi chú, lịch hẹn…) và KH
                được nick nhân viên khác chăm. Giữ nguyên hội thoại.
              </div>
            </div>
          </label>

          <label class="mode-card mode-card-danger" :class="{ 'mode-on-danger': wipeAll }">
            <input type="radio" :value="true" v-model="wipeAll" @change="onScopeChange" />
            <div class="mode-body">
              <div class="mode-title">🔥 Xoá tất cả của nhân viên này</div>
              <div class="mode-desc">
                Không chừa gì thuộc về nhân viên này: xoá cả KH đã có SĐT / ghi chú / lịch hẹn,
                xoá kèm toàn bộ hội thoại 1-1 và tin nhắn của các nick đã chọn.
              </div>
            </div>
          </label>
        </div>

        <p class="mode-note">
          Dù chọn mức nào: KH mà <strong>nick của nhân viên khác</strong> cũng đang chăm thì chỉ bị
          cắt liên kết với nick của người này, KH vẫn còn — để không phá dữ liệu của đồng nghiệp.
          Và luôn <strong>không</strong> huỷ kết bạn trên Zalo.
        </p>

        <div class="step-actions">
          <button
            class="btn-primary"
            :disabled="selectedAccountIds.length === 0 || previewing"
            @click="onPreview"
          >
            {{ previewing ? 'Đang tính…' : 'Xem trước số liệu sẽ xoá' }}
          </button>
          <span v-if="selectedAccountIds.length === 0" class="hint-inline">Chọn ít nhất 1 nick</span>
        </div>
      </section>

      <!-- BƯỚC 3 — xem trước + xác nhận -->
      <section v-if="plan" class="step-block">
        <div class="step-head">
          <span class="step-badge">3</span>
          <h2 class="step-title">Xem trước &amp; xác nhận</h2>
        </div>

        <div class="stats-row">
          <div class="stat-card stat-danger">
            <div class="stat-label">KH sẽ bị xoá hẳn</div>
            <div class="stat-value">{{ formatNum(plan.counts.contactsToDelete) }}</div>
          </div>
          <div class="stat-card stat-primary">
            <div class="stat-label">Liên kết nick ↔ KH bị cắt</div>
            <div class="stat-value">{{ formatNum(plan.counts.friendsToDelete) }}</div>
          </div>
          <div class="stat-card stat-forest">
            <div class="stat-label">KH được giữ lại</div>
            <div class="stat-value">{{ formatNum(keptTotal) }}</div>
          </div>
          <div class="stat-card stat-mustard">
            <div class="stat-label">Nick sẽ tạm dừng đồng bộ</div>
            <div class="stat-value">{{ plan.accounts.length }}</div>
          </div>
        </div>

        <ul class="detail-list">
          <li v-if="plan.counts.contactsKeptSharedWithOthers > 0">
            <strong>{{ formatNum(plan.counts.contactsKeptSharedWithOthers) }}</strong> KH được giữ vì nick của
            nhân viên khác vẫn đang chăm — chỉ cắt liên kết với nick của
            {{ plan.user.fullName || plan.user.email }}.
          </li>
          <li v-if="plan.counts.contactsKeptCurated > 0">
            <strong>{{ formatNum(plan.counts.contactsKeptCurated) }}</strong> KH được giữ vì đã có dữ liệu
            người thật nhập (SĐT, ghi chú, lịch hẹn…).
          </li>
          <li v-if="plan.counts.appointmentsLost > 0 || plan.counts.notesLost > 0" class="li-warn">
            Sẽ mất theo KH bị xoá: <strong>{{ plan.counts.appointmentsLost }}</strong> lịch hẹn,
            <strong>{{ plan.counts.notesLost }}</strong> ghi chú.
          </li>
          <li v-if="plan.deleteConversations" class="li-warn">
            Xoá kèm <strong>{{ formatNum(plan.counts.conversationsToDelete) }}</strong> hội thoại và
            <strong>{{ formatNum(plan.counts.messagesToDelete) }}</strong> tin nhắn.
          </li>
          <li v-if="plan.counts.contactsToDelete === 0 && plan.counts.friendsToDelete === 0">
            Không có gì để xoá trong phạm vi đã chọn.
          </li>
        </ul>

        <div v-if="plan.sampleContactsToDelete.length > 0" class="sample-box">
          <div class="sample-head">Mẫu {{ plan.sampleContactsToDelete.length }} KH sẽ bị xoá (mới nhất)</div>
          <div class="sample-list">
            <span v-for="c in plan.sampleContactsToDelete" :key="c.id" class="sample-chip">
              {{ c.fullName || '(không tên)' }}<template v-if="c.phone"> · {{ c.phone }}</template>
            </span>
          </div>
        </div>

        <!-- Xác nhận bằng cách gõ đúng chuỗi — chặn bấm nhầm -->
        <div v-if="planHasWork" class="confirm-box">
          <div class="confirm-warn">
            Thao tác này <strong>không hoàn tác được</strong>. Để xác nhận, gõ email của nhân viên:
            <code>{{ plan.confirmPhrase }}</code>
          </div>
          <div class="confirm-row">
            <input
              class="field-input confirm-input"
              v-model="confirmText"
              :placeholder="plan.confirmPhrase"
              autocomplete="off"
            />
            <button class="btn-danger" :disabled="!confirmOk || executing" @click="onExecute">
              {{ executing ? 'Đang xoá…' : (plan.keepCurated ? 'Xoá dữ liệu' : 'Xoá tất cả của nhân viên này') }}
            </button>
          </div>
        </div>
      </section>

      <!-- KẾT QUẢ -->
      <section v-if="result" class="step-block">
        <div class="notice notice-done">
          <div class="notice-ico">✅</div>
          <div class="notice-body">
            <strong>Đã xoá xong.</strong>
            {{ formatNum(result.contactsDeleted) }} KH bị xoá hẳn ·
            {{ formatNum(result.friendsDeleted) }} liên kết nick bị cắt ·
            {{ formatNum(result.contactsKept) }} KH được giữ lại
            <template v-if="result.conversationsDeleted > 0">
              · {{ formatNum(result.conversationsDeleted) }} hội thoại ·
              {{ formatNum(result.messagesDeleted) }} tin nhắn
            </template>
            ({{ result.durationMs }}ms)
            <br />
            <span class="result-note">
              {{ result.accountsPaused.length }} nick đã được tạm dừng đồng bộ. Khi nào muốn hút lại danh sách
              bạn từ Zalo, bấm “Bật lại đồng bộ” ở bước 2.
            </span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useContactPurge, type PurgeTargetUser } from '@/composables/use-contact-purge';

const {
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
} = useContactPurge();

const selectedUserId = ref('');
const selectedAccountIds = ref<string[]>([]);
const confirmText = ref('');
/**
 * Mức độ xoá cho nhân viên ĐANG CHỌN:
 *   false = xoá an toàn (giữ KH đã chăm thật, giữ hội thoại)
 *   true  = xoá tất cả của nhân viên này (không chừa KH nào, xoá kèm hội thoại)
 * Phạm vi luôn bó trong các nick của nhân viên đã chọn — không bao giờ động
 * tới nhân viên khác.
 */
const wipeAll = ref(false);

const selectedUser = computed<PurgeTargetUser | null>(
  () => targets.value.find((u) => u.id === selectedUserId.value) ?? null,
);

const allNicksSelected = computed(
  () =>
    !!selectedUser.value &&
    selectedUser.value.accounts.length > 0 &&
    selectedAccountIds.value.length === selectedUser.value.accounts.length,
);

const keptTotal = computed(() =>
  plan.value ? plan.value.counts.contactsKeptSharedWithOthers + plan.value.counts.contactsKeptCurated : 0,
);

// So khớp không phân biệt hoa thường — BE cũng so lowercase.
const confirmOk = computed(
  () =>
    !!plan.value &&
    confirmText.value.trim().toLowerCase() === plan.value.confirmPhrase.toLowerCase(),
);

/** Có gì để xoá không — phạm vi luôn là các nick của nhân viên đã chọn. */
const planHasWork = computed(() => {
  const p = plan.value;
  if (!p) return false;
  return p.counts.friendsToDelete > 0 || p.counts.conversationsToDelete > 0;
});

function selectUser(u: PurgeTargetUser) {
  if (selectedUserId.value === u.id) return;
  selectedUserId.value = u.id;
  // Mặc định chọn hết nick của nhân viên — tình huống phổ biến nhất là hoàn tác
  // cả lần đồng bộ của người đó.
  selectedAccountIds.value = u.accounts.map((a) => a.id);
  onScopeChange();
}

function toggleAllNicks() {
  if (!selectedUser.value) return;
  selectedAccountIds.value = allNicksSelected.value ? [] : selectedUser.value.accounts.map((a) => a.id);
  onScopeChange();
}

/** Đổi phạm vi → plan cũ không còn đúng, xoá đi để admin buộc phải xem trước lại. */
function onScopeChange() {
  reset();
  confirmText.value = '';
}

function currentScope() {
  // "Xoá tất cả" = bỏ mọi luật giữ lại + xoá kèm hội thoại, nhưng VẪN bó trong
  // các nick của nhân viên đang chọn.
  return {
    userId: selectedUserId.value,
    zaloAccountIds: selectedAccountIds.value,
    keepCurated: !wipeAll.value,
    deleteConversations: wipeAll.value,
  };
}

async function onPreview() {
  confirmText.value = '';
  await preview(currentScope());
}

async function onExecute() {
  if (!confirmOk.value) return;
  const ok = await execute(currentScope(), confirmText.value.trim());
  if (ok) {
    plan.value = null;
    confirmText.value = '';
  }
}

async function onResume(ids: string[]) {
  await resumeSync(ids);
}

// ── Helpers hiển thị ───────────────────────────────────────────────────────

function formatNum(n: number): string {
  return new Intl.NumberFormat('vi-VN').format(n ?? 0);
}

function statusLabel(s: string): string {
  if (s === 'connected') return 'Đang kết nối';
  if (s === 'qr_pending') return 'Chờ quét QR';
  return 'Mất kết nối';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = ['#1b61c9', '#0a2e0e', '#7a5818', '#aa2d00', '#4a2b7a', '#065f63'];
function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

onMounted(fetchTargets);
</script>

<style scoped>
/* ── Notice banners ── */
.notice {
  display: flex;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 10px;
  margin-bottom: 20px;
  font-size: 13px;
  line-height: 1.55;
}
.notice-ico { font-size: 16px; flex-shrink: 0; line-height: 1.4; }
.notice-body { min-width: 0; }
.notice-info { background: #eef4fd; border: 1px solid #cfe0f7; color: #1b3a63; }
.notice-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
.notice-done { background: #e3ede4; border: 1px solid #c8d8c9; color: #0a2e0e; }
.result-note { color: #41454d; font-size: 12px; }

/* ── Chọn mức độ xoá cho nhân viên đang chọn ── */
.mode-head {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.6px; color: #41454d; margin: 18px 0 8px;
}
.mode-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
.mode-card {
  display: flex; gap: 11px; align-items: flex-start;
  background: white; border: 1px solid #e0e2e6; border-radius: 10px;
  padding: 13px 15px; cursor: pointer; transition: all 0.12s;
}
.mode-card:hover { border-color: #c9ccd1; }
.mode-card input[type='radio'] {
  width: 15px; height: 15px; margin-top: 2px; flex-shrink: 0;
  cursor: pointer; accent-color: #181d26;
}
.mode-card.mode-on { border-color: #181d26; background: #fafbfc; }
.mode-card-danger input[type='radio'] { accent-color: #991b1b; }
.mode-card.mode-on-danger { border-color: #991b1b; background: #fef2f2; }
.mode-body { min-width: 0; }
.mode-title { font-size: 13px; font-weight: 600; color: #181d26; }
.mode-card-danger .mode-title { color: #991b1b; }
.mode-rec { font-size: 11px; font-weight: 600; color: #0a2e0e; }
.mode-desc { font-size: 11.5px; color: #6b7280; margin-top: 4px; line-height: 1.55; }
.mode-note {
  font-size: 11.5px; color: #6b7280; line-height: 1.6;
  margin: 10px 0 0; padding-left: 2px;
}

/* ── Step blocks ── */
.step-block { margin-bottom: 28px; }
.step-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.step-badge {
  width: 22px; height: 22px; border-radius: 50%;
  background: #181d26; color: white;
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.step-title { font-size: 15px; font-weight: 600; color: #181d26; margin: 0; }
.step-actions { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
.hint-inline { font-size: 12px; color: #9297a0; }
.btn-link {
  margin-left: auto; background: none; border: 0; cursor: pointer;
  font-size: 12px; font-weight: 500; color: #1b61c9; padding: 2px 4px;
}
.btn-link:hover { text-decoration: underline; }

/* ── Bảng nhân viên ── */
.at-table-wrap {
  background: white; border: 1px solid #e0e2e6; border-radius: 12px;
  overflow: hidden; box-shadow: 0 1px 3px rgba(24,29,38,0.04);
}
.at-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.at-table thead th {
  background: #f8fafc; padding: 11px 14px; text-align: left;
  font-weight: 600; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.6px; color: #41454d;
  border-bottom: 2px solid #e0e2e6; white-space: nowrap;
}
.th-num { width: 46px; text-align: center !important; }
.th-name { min-width: 200px; }
.th-email { min-width: 180px; }
.th-nicks { width: 170px; }
.th-count { width: 130px; }
.th-sel { width: 44px; }
.at-table tbody tr {
  cursor: pointer; border-bottom: 1px solid #f0f1f3; transition: background 0.1s;
}
.at-table tbody tr:hover { background: #f8fafc; }
.at-table tbody tr.row-active { background: #fdf3df; }
.at-table tbody tr:last-child { border-bottom: 0; }
.at-table tbody td { padding: 11px 14px; vertical-align: middle; }
.cell-num { text-align: center; color: #9297a0; font-size: 11px; font-weight: 500; }
.cell-name { display: flex; align-items: center; gap: 10px; }
.cell-name-text { min-width: 0; }
.cell-name-main { font-size: 13px; font-weight: 500; color: #181d26; line-height: 1.2; }
.cell-name-sub { font-size: 10px; font-weight: 600; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.4px; }
.inactive-tag { color: #9297a0; }
.cell-email {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 12px; color: #41454d;
}
.cell-strong { font-size: 14px; font-weight: 600; color: #181d26; }
.cell-sel { text-align: center; }
.sel-mark { color: #0a2e0e; font-weight: 700; }
.at-avatar {
  width: 30px; height: 30px; border-radius: 50%; color: white;
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.at-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px; border-radius: 9999px;
  font-size: 11px; font-weight: 500; line-height: 1.2; white-space: nowrap;
}
.chip-member { background: #f0f1f3; color: #41454d; }
.chip-paused { background: #f5e9d4; color: #aa2d00; margin-left: 6px; }

/* ── Nick grid ── */
.nick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 10px; }
.nick-card {
  display: flex; align-items: center; gap: 11px;
  background: white; border: 1px solid #e0e2e6; border-radius: 10px;
  padding: 12px 14px; cursor: pointer; transition: all 0.12s;
}
.nick-card:hover { border-color: #c9ccd1; }
.nick-card.nick-on { border-color: #181d26; background: #fafbfc; }
.nick-card input[type='checkbox'] { width: 15px; height: 15px; flex-shrink: 0; cursor: pointer; accent-color: #181d26; }
.nick-info { flex: 1; min-width: 0; }
.nick-name {
  font-size: 13px; font-weight: 500; color: #181d26;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nick-meta { font-size: 11px; color: #9297a0; margin-top: 3px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.nick-uid { font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace; }
.dot { color: #c9ccd1; }
.st-on { color: #0a2e0e; font-weight: 500; }
.st-off { color: #aa2d00; }
.nick-right { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; }
.btn-quick {
  background: white; border: 1px solid #d8d9dd; border-radius: 6px;
  padding: 4px 9px; font-size: 11px; font-weight: 500; cursor: pointer; color: #41454d;
}
.btn-quick-add { color: #0a2e0e; border-color: #c8d8c9; }
.btn-quick:hover:not(:disabled) { background: #f3f4f6; }
.btn-quick:disabled { opacity: 0.5; cursor: not-allowed; }

/* ── Tuỳ chọn ── */
.opts { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }
.opt-row {
  display: flex; gap: 11px; align-items: flex-start;
  background: white; border: 1px solid #e0e2e6; border-radius: 10px;
  padding: 12px 14px; cursor: pointer;
}
.opt-row input[type='checkbox'] { width: 15px; height: 15px; margin-top: 2px; flex-shrink: 0; cursor: pointer; accent-color: #181d26; }
.opt-label { font-size: 13px; font-weight: 500; color: #181d26; }
.opt-rec { font-size: 11px; font-weight: 600; color: #0a2e0e; }
.opt-hint { font-size: 11.5px; color: #6b7280; margin-top: 3px; line-height: 1.5; }

/* ── Stat danger variant (bổ sung cho rbac-page.css) ── */
.stat-danger { background: #fef2f2; }
.stat-danger .stat-value { color: #991b1b; }

/* ── Chi tiết plan ── */
.detail-list { margin: 4px 0 0; padding-left: 18px; font-size: 13px; color: #41454d; line-height: 1.75; }
.detail-list .li-warn { color: #aa2d00; }

/* ── Mẫu KH ── */
.sample-box {
  margin-top: 16px; background: white; border: 1px solid #e0e2e6;
  border-radius: 10px; padding: 12px 14px;
}
.sample-head {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.6px; color: #41454d; margin-bottom: 9px;
}
.sample-list { display: flex; flex-wrap: wrap; gap: 6px; }
.sample-chip {
  background: #f0f1f3; color: #41454d; border-radius: 9999px;
  padding: 4px 10px; font-size: 11.5px;
}

/* ── Hộp xác nhận ── */
.confirm-box {
  margin-top: 20px; background: #fef2f2; border: 1px solid #fecaca;
  border-radius: 10px; padding: 14px 16px;
}
.confirm-warn { font-size: 13px; color: #991b1b; line-height: 1.6; margin-bottom: 11px; }
.confirm-warn code {
  background: white; border: 1px solid #fecaca; border-radius: 5px;
  padding: 1px 6px; font-size: 12px; color: #991b1b;
}
.confirm-row { display: flex; gap: 9px; align-items: center; flex-wrap: wrap; }
.field-input {
  padding: 8px 11px; border: 1px solid #d8d9dd; border-radius: 7px;
  font-size: 13px; font-family: inherit; color: #181d26; outline: none;
}
.field-input:focus { border-color: #181d26; }
.confirm-input { flex: 1; min-width: 240px; background: white; }
.btn-danger {
  background: #991b1b; color: white; border: 1px solid #991b1b;
  padding: 8px 18px; border-radius: 7px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: all 0.12s; white-space: nowrap;
}
.btn-danger:hover:not(:disabled) { background: #7f1616; border-color: #7f1616; }
.btn-danger:disabled { opacity: 0.45; cursor: not-allowed; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
