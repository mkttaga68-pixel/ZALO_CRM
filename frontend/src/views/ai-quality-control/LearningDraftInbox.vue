<template>
  <section :class="['learning', { 'has-pending': pending > 0 }]" aria-labelledby="learning-heading">
    <header class="learning-head">
      <div class="learning-title">
        <span class="learning-bell"><v-icon size="19">{{ pending ? 'mdi-bell-ring-outline' : 'mdi-bell-check-outline' }}</v-icon></span>
        <div>
          <h3 id="learning-heading">Bài học AI đề xuất<span v-if="pending" class="learning-count" :aria-label="`${pending} bản nháp chờ duyệt`">{{ pending }} chờ duyệt</span></h3>
          <p>AI rà soát hội thoại đã phân tích sau 22:00 và đề xuất bản nháp kiến thức. Bản nháp không được dùng để đánh giá cho tới khi Admin phê duyệt.</p>
        </div>
      </div>
      <div class="learning-actions">
        <span v-if="live" class="live-pill" title="Đã kết nối cập nhật trực tiếp"><i />Trực tiếp</span>
        <v-btn v-if="syntheticOnly && canSandbox" size="small" variant="tonal" prepend-icon="mdi-flask-outline" :loading="busy" @click="runSandbox">Chạy thử (dữ liệu thử nghiệm)</v-btn>
        <v-btn icon="mdi-refresh" variant="text" size="small" density="comfortable" :loading="busy" aria-label="Làm mới bài học AI" @click="load" />
      </div>
    </header>
    <div class="learning-legend" aria-label="Phân loại kiến thức">
      <span><i class="dot policy" />Quy tắc chính thức — đồng bộ từ Obsidian, Admin duyệt</span>
      <span><i class="dot case" />Tình huống tham chiếu — bài học đã duyệt, chỉ dùng tham khảo</span>
      <span><i class="dot draft" />Bản nháp bài học — chưa duyệt, không dùng cho AI</span>
    </div>
    <div v-if="health" class="learning-health" data-testid="learning-health">
      <span :class="['health-dot', health.scheduler.allowed ? 'on' : 'off']" />
      <span v-if="health.scheduler.allowed && health.scheduler.schedule">Tự động chạy lúc {{ pad(health.scheduler.schedule.hour) }}:{{ pad(health.scheduler.schedule.minute) }} ({{ health.scheduler.schedule.timeZone }})</span>
      <span v-else>Lịch tự động chưa kích hoạt<template v-if="health.scheduler.blockers.length">: {{ health.scheduler.blockers.map(blockerLabel).join(' · ') }}</template></span>
      <span v-if="health.lastJob" class="muted">· Lần chạy gần nhất {{ time(health.lastJob.at) }} (+{{ health.lastJob.created }} mới, {{ health.lastJob.merged }} bổ sung)</span>
      <span v-if="health.outbox.failed" class="health-warn">· {{ health.outbox.failed }} bản nháp ghi thư mục Obsidian thất bại</span>
      <span v-if="health.alerts.includes('LEARNING_CAPACITY_NEAR_LIMIT')" class="health-warn">· Sắp đạt giới hạn {{ health.drafts.limit }} bản nháp — cần xét duyệt hoặc dọn dữ liệu</span>
      <span v-if="health.alerts.includes('DRAFTS_EXPIRING_WITHIN_7_DAYS')" class="health-warn">· Có bản nháp sắp hết hạn xét duyệt</span>
    </div>
    <div class="learning-filter" role="tablist" aria-label="Lọc bài học">
      <button v-for="f in filters" :key="f.value" type="button" role="tab" :aria-selected="filter === f.value" :class="{ active: filter === f.value }" @click="filter = f.value">{{ f.title }}<strong>{{ count(f.value) }}</strong></button>
    </div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mx-5 mb-3" closable @click:close="error = ''">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" density="compact" class="mx-5 mb-3" closable @click:close="notice = ''">{{ notice }}</v-alert>
    <div v-if="canPurge && filter === 'DONE'" class="learning-purge">
      <span class="muted">Dọn bản nháp đã từ chối/hết hạn quá thời gian lưu trữ đã duyệt; bài học đã phê duyệt chỉ bị xóa bằng chứng.</span>
      <v-btn size="small" variant="outlined" color="error" prepend-icon="mdi-broom" :disabled="busy" @click="purgeDialog = true">Dọn theo chính sách lưu trữ</v-btn>
    </div>
    <v-table density="compact" class="learning-table">
      <thead><tr><th>Bài học</th><th>Quy tắc / nhóm liên quan</th><th>Phát hiện</th><th>Nguồn</th><th class="num">Tình huống</th><th>Trạng thái</th><th><span class="sr-only">Thao tác</span></th></tr></thead>
      <tbody>
        <tr v-for="d in shown" :key="d.id">
          <td><button type="button" class="learning-link" @click="open(d.id)">{{ d.title }}</button><div v-if="d.synthetic" class="muted">Dữ liệu thử nghiệm</div></td>
          <td><div>{{ d.relatedRuleLabels.join(', ') || '—' }}</div><div class="muted">{{ qcLabel(d.findingType) }} · {{ kindLabel(d.lessonKind) }}</div></td>
          <td><time :datetime="d.detectedAt">{{ time(d.detectedAt) }}</time></td>
          <td><span class="source-chip"><v-icon size="13">mdi-creation-outline</v-icon>AI Nightly Learning</span></td>
          <td class="num">{{ d.caseCount }}</td>
          <td><v-chip size="small" variant="tonal" :color="tone(d.status)">{{ statusLabel(d.status) }}</v-chip></td>
          <td class="action"><v-btn size="small" variant="tonal" color="primary" @click="open(d.id)">{{ d.status === 'DRAFT' ? 'Xem và duyệt' : 'Xem chi tiết' }}</v-btn></td>
        </tr>
        <tr v-if="!shown.length"><td colspan="7"><div class="learning-empty"><v-icon size="28" color="grey">mdi-lightbulb-on-outline</v-icon><p>{{ filter === 'OPEN' ? 'Không có bài học mới chờ duyệt.' : 'Không có bài học trong mục này.' }}</p></div></td></tr>
      </tbody>
    </v-table>

    <v-dialog v-model="purgeDialog" max-width="520">
      <v-card>
        <v-card-title>Dọn bài học theo chính sách lưu trữ</v-card-title>
        <v-card-text>
          <p class="muted mb-3">Chỉ xóa bản nháp đã từ chối hoặc hết hạn và đã quá thời gian lưu trữ được duyệt. Bài học bị từ chối vẫn không được đề xuất lại trong 30 ngày. Thao tác được ghi nhật ký.</p>
          <v-textarea v-model="purgeReason" label="Lý do (bắt buộc)" rows="2" density="compact" counter="1000" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn variant="text" @click="purgeDialog = false">Hủy</v-btn><v-btn color="error" :loading="busy" :disabled="!purgeReason.trim()" @click="purge">Dọn dữ liệu</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="dialog" max-width="1100" scrollable>
      <v-card v-if="detail" class="learning-dialog">
        <v-card-title class="dialog-head">
          <div><div class="eyebrow">BẢN NHÁP BÀI HỌC · Phiên bản {{ detail.revision }}</div><h2>{{ detail.title }}</h2>
            <div class="dialog-meta"><v-chip size="small" variant="tonal" :color="tone(detail.status)">{{ statusLabel(detail.status) }}</v-chip><span>{{ qcLabel(detail.findingType) }}</span><span>{{ detail.caseCount }} tình huống</span><span>Phát hiện {{ time(detail.detectedAt) }}</span></div></div>
          <v-btn icon="mdi-close" size="small" variant="text" aria-label="Đóng" @click="dialog = false" />
        </v-card-title>
        <v-card-text class="dialog-body">
          <div class="detail-grid">
            <div class="detail-main">
              <section><h4><v-icon size="16">mdi-head-lightbulb-outline</v-icon>Nguyên nhân AI đề xuất</h4><p>{{ detail.rationale }}</p></section>
              <section><h4><v-icon size="16">mdi-shield-lock-outline</v-icon>Bằng chứng đã giảm thiểu dữ liệu</h4>
                <p class="muted">Chỉ gồm mã tham chiếu băm, loại nhận xét, số tin nhắn và trạng thái đối soát — không có nội dung hội thoại hay thông tin khách hàng.</p>
                <p v-if="detail.evidencePurgedAt" class="muted">Bằng chứng đã được xóa theo chính sách lưu trữ ({{ time(detail.evidencePurgedAt) }}).</p>
                <v-table density="compact" class="evidence"><thead><tr><th>Tham chiếu</th><th>Nhận xét</th><th class="num">Tin nhắn</th><th>Đối soát</th><th>Thời điểm</th></tr></thead><tbody>
                  <tr v-for="e in detail.evidence" :key="e.ref"><td><code>{{ e.ref }}</code></td><td>{{ qcLabel(e.findingStatus) }}<div v-if="e.missingContext.length" class="muted">Thiếu: {{ e.missingContext.map(qcLabel).join(', ') }}</div></td><td class="num">{{ e.messageCount }}</td><td>{{ qcLabel(e.reviewStatus) }}</td><td>{{ time(e.observedAt) }}</td></tr>
                </tbody></v-table>
              </section>
              <section><h4><v-icon size="16">mdi-book-open-page-variant-outline</v-icon>Quy tắc Obsidian liên quan</h4>
                <div v-for="r in detail.relatedRules" :key="r.documentId + r.revision" class="rule-card">
                  <div class="rule-top"><strong>{{ r.label }}</strong><span class="muted">phiên bản {{ r.revision }}<template v-if="r.currentRevision && r.currentRevision !== r.revision"> · hiện hành r{{ r.currentRevision }}</template></span>
                    <v-chip size="x-small" variant="tonal" :color="r.citationValid && r.currentlyEffective ? 'success' : 'warning'">{{ r.citationValid && r.currentlyEffective ? 'Trích dẫn hợp lệ, đang hiệu lực' : 'Cần kiểm tra trích dẫn' }}</v-chip></div>
                  <div class="muted">{{ r.sourcePath }}</div><blockquote>{{ r.quote }}</blockquote>
                </div>
              </section>
              <section><h4><v-icon size="16">mdi-file-document-outline</v-icon>Nội dung bản nháp</h4><KnowledgeDocumentPreview :markdown="detail.markdown" />
                <details class="raw"><summary>Markdown gốc và mã xác thực</summary><pre>{{ detail.markdown }}</pre><p class="muted">SHA-256 {{ detail.contentHash }}</p></details></section>
              <section><h4><v-icon size="16">mdi-history</v-icon>Lịch sử xét duyệt</h4>
                <ol class="history"><li v-for="(h, i) in detail.reviewHistory" :key="i"><time>{{ time(h.at) }}</time><strong>{{ historyLabel(h.action) }}</strong><span class="muted">r{{ h.revision }} · {{ h.actorId.startsWith('system:') ? 'Hệ thống' : (names[h.actorId] ?? 'Quản trị viên') }}</span><p v-if="h.note">{{ h.note }}</p></li></ol>
                <p class="muted">Nguồn tạo: {{ detail.provenance.generator }} · {{ detail.provenance.jobIds.length }} lần chạy · Obsidian: {{ exportLabel(detail.obsidianExport.status) }}</p>
              </section>
            </div>
            <aside class="detail-side">
              <p v-if="!canDecide && (detail.status === 'DRAFT' || detail.status === 'CHANGES_REQUESTED')" class="side-note" data-testid="learning-no-decide">Bạn có thể xem bản nháp. Để xác minh, phê duyệt, yêu cầu sửa hoặc từ chối cần quyền <strong>Duyệt</strong> và <strong>Xem toàn bộ</strong> của Kiểm soát chất lượng AI.</p>
              <template v-if="detail.status === 'DRAFT' && canDecide">
                <div :class="['step', { done: detail.tenantScopeVerified }]"><span>1</span><div><strong>Xác minh phạm vi tổ chức</strong><p class="muted">Kiểm tra bản nháp, phòng ban và nguồn dữ liệu thuộc đúng tổ chức của bạn.</p>
                  <v-btn v-if="!detail.tenantScopeVerified" size="small" variant="outlined" :loading="busy" @click="act('verify-scope', {})">Xác minh phạm vi</v-btn><span v-else class="ok"><v-icon size="15">mdi-check-circle</v-icon>Đã xác minh</span></div></div>
                <div class="step"><span>2</span><div><strong>Phê duyệt thành tình huống tham chiếu</strong><p class="muted">Hệ thống kiểm tra quyền, phiên bản, trích dẫn quy tắc và kiểm thử hồi quy trước khi đưa vào kho truy xuất.</p>
                  <v-checkbox v-model="confirm" density="compact" hide-details label="Tôi đã đọc nội dung và xác nhận có thẩm quyền phê duyệt" />
                  <v-btn color="primary" size="small" :disabled="busy || !confirm || !detail.tenantScopeVerified" @click="act('approve', { contentHash: detail.contentHash, confirm: true })">Phê duyệt</v-btn></div></div>
                <v-divider class="my-3" />
                <v-textarea v-model="note" label="Ghi chú cho AI / người soạn" rows="2" density="compact" counter="1000" hide-details="auto" />
                <div class="side-actions"><v-btn size="small" variant="outlined" :disabled="busy || !note.trim()" @click="act('request-changes', { note })">Yêu cầu chỉnh sửa</v-btn><v-btn size="small" variant="outlined" color="error" :disabled="busy || !note.trim()" @click="act('reject', { reason: note })">Từ chối</v-btn></div>
              </template>
              <template v-else-if="detail.status === 'CHANGES_REQUESTED' && canDecide">
                <p class="side-note">Đã yêu cầu chỉnh sửa. Lần chạy tiếp theo có tình huống mới sẽ cập nhật bản nháp, hoặc người có quyền chỉnh sửa có thể sửa trực tiếp bên dưới.</p>
                <template v-if="canRevise"><v-text-field v-model="revision.title" label="Tên bài học" density="compact" /><v-textarea v-model="revision.rationale" label="Nguyên nhân / hướng dẫn" rows="4" density="compact" counter="1000" />
                  <p class="muted">Không nhập tên, số điện thoại, email hay nội dung nguyên văn của khách hàng.</p>
                  <v-btn size="small" color="primary" :disabled="busy || !revision.title.trim() || !revision.rationale.trim()" @click="act('revise', { title: revision.title, rationale: revision.rationale })">Lưu phiên bản mới</v-btn></template>
                <v-btn class="mt-2" size="small" variant="text" color="error" :disabled="busy || !note.trim()" @click="act('reject', { reason: note })">Từ chối</v-btn>
                <v-textarea v-model="note" label="Lý do từ chối" rows="2" density="compact" hide-details />
              </template>
              <p v-else-if="detail.status !== 'DRAFT' && detail.status !== 'CHANGES_REQUESTED'" class="side-note">{{ detail.status === 'APPROVED' ? 'Đã phê duyệt thành tình huống tham chiếu. Có thể thu hồi trong danh sách tài liệu bên dưới.' : detail.status === 'REJECTED' ? 'Bản nháp đã bị từ chối. Bài học trùng sẽ không được đề xuất lại trong 30 ngày.' : 'Bản nháp đã hết hạn vì không được xét duyệt trong 30 ngày.' }}</p>
              <div v-if="detail.regression" class="regression"><strong>Kiểm thử hồi quy {{ detail.regression.passed ? 'đạt' : 'không đạt' }}</strong>
                <ul><li v-for="c in detail.regression.checks" :key="c.id"><v-icon size="14" :color="c.passed ? 'success' : 'error'">{{ c.passed ? 'mdi-check' : 'mdi-close' }}</v-icon>{{ checkLabel(c.id) }}</li></ul></div>
            </aside>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { qcRequest, type LearningDraftDetail, type LearningDraftItem, type LearningDraftStatus, type LearningHealth, type LearningPurgeResult } from '@/api/ai-quality-control';
import { qcError, qcLabel } from './presentation';
const KnowledgeDocumentPreview = defineAsyncComponent(() => import('./KnowledgeDocumentPreview.vue'));

// Capabilities mirror the backend checks exactly, so no control is shown that would only return 403.
const props = defineProps<{ revision: number; live: boolean; pending: number; canDecide: boolean; canRevise: boolean; canSandbox: boolean; canPurge: boolean; syntheticOnly: boolean; names: Record<string, string> }>();
const emit = defineEmits<{ changed: [kind: 'decision' | 'draft'] }>();
const items = ref<LearningDraftItem[]>([]), detail = ref<LearningDraftDetail | null>(null), dialog = ref(false), busy = ref(false), error = ref(''), notice = ref('');
const filter = ref<'OPEN' | 'CHANGES_REQUESTED' | 'DONE'>('OPEN'), confirm = ref(false), note = ref(''), revision = ref({ title: '', rationale: '' });
const health = ref<LearningHealth | null>(null), purgeDialog = ref(false), purgeReason = ref('');
const pad = (n: number) => String(n).padStart(2, '0');
const BLOCKERS: Record<string, string> = { NIGHTLY_LEARNING_DISABLED: 'đang tắt', SCHEDULE_NOT_APPROVED: 'chưa duyệt lịch chạy (từ 22:00)', SCHEDULE_TIMEZONE_INVALID: 'múi giờ không hợp lệ', DATA_SCOPE_NOT_APPROVED: 'chưa duyệt phạm vi dữ liệu', DATA_SCOPE_TENANT_MISMATCH: 'phạm vi dữ liệu không khớp tổ chức', PERSISTENT_STORAGE_REQUIRED: 'cần lưu trữ cố định', DEPLOYMENT_TIER_REQUIRED: 'chưa khai báo môi trường', DEPLOYMENT_TIER_INVALID: 'môi trường không hợp lệ', PRODUCTION_NO_GO: 'production chưa được phê duyệt GO' };
const blockerLabel = (b: string) => BLOCKERS[b] ?? b;
const filters = [{ title: 'Chờ duyệt', value: 'OPEN' as const }, { title: 'Yêu cầu sửa', value: 'CHANGES_REQUESTED' as const }, { title: 'Đã xử lý', value: 'DONE' as const }];
const inFilter = (d: LearningDraftItem, f: string) => f === 'OPEN' ? d.status === 'DRAFT' : f === 'CHANGES_REQUESTED' ? d.status === 'CHANGES_REQUESTED' : ['APPROVED', 'REJECTED', 'EXPIRED'].includes(d.status);
const count = (f: string) => items.value.filter(d => inFilter(d, f)).length;
const shown = computed(() => items.value.filter(d => inFilter(d, filter.value)));
const STATUS: Record<LearningDraftStatus, string> = { DRAFT: 'Chờ duyệt', CHANGES_REQUESTED: 'Yêu cầu sửa', APPROVED: 'Đã phê duyệt', REJECTED: 'Đã từ chối', EXPIRED: 'Hết hạn' };
const statusLabel = (s: LearningDraftStatus) => STATUS[s] ?? s;
const tone = (s: LearningDraftStatus) => s === 'DRAFT' ? 'warning' : s === 'APPROVED' ? 'success' : s === 'REJECTED' ? 'error' : 'secondary';
const kindLabel = (k: string) => k === 'MISSING_CONTEXT' ? 'Thiếu ngữ cảnh' : 'Tình huống lặp lại';
const HISTORY: Record<string, string> = { CREATED: 'AI tạo bản nháp', MERGED_NEW_EVIDENCE: 'AI bổ sung tình huống mới', TENANT_SCOPE_VERIFIED: 'Xác minh phạm vi tổ chức', CHANGES_REQUESTED: 'Yêu cầu chỉnh sửa', REVISED: 'Chỉnh sửa nội dung', APPROVED: 'Phê duyệt', REJECTED: 'Từ chối', EXPIRED_UNREVIEWED: 'Hết hạn (không xét duyệt)', APPROVAL_BLOCKED_BY_REGRESSION: 'Chặn phê duyệt do kiểm thử hồi quy' };
const historyLabel = (a: string) => HISTORY[a] ?? a;
const CHECKS: Record<string, string> = { BASELINE_RETRIEVAL_OK: 'Kho truy xuất hiện tại hoạt động', DRAFT_ABSENT_FROM_APPROVED_RETRIEVAL: 'Bản nháp chưa nằm trong kho đã duyệt', POLICY_COVERAGE_PRESERVED: 'Giữ nguyên độ phủ quy tắc chính thức', NO_KNOWLEDGE_CONFLICT: 'Không xung đột kiến thức', CANDIDATE_EFFECTIVE_AFTER_APPROVAL: 'Có hiệu lực sau khi duyệt', NO_TERM_RULE_INJECTION: 'Không thêm từ khóa đánh giá mới', NO_DUPLICATE_VERIFIED_CASE: 'Không trùng tình huống đã duyệt', LABELLED_DATASET_STABILITY: 'Không đổi kết quả bộ mẫu đã gán nhãn' };
const checkLabel = (id: string) => CHECKS[id] ?? id;
const exportLabel = (s: string) => s === 'WRITTEN' ? 'đã ghi vào thư mục chờ đồng bộ' : s === 'FAILED' ? 'ghi thất bại' : 'chưa cấu hình thư mục ghi';
const time = (v: string) => new Date(v).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const ERRORS: Record<string, string> = {
  WORKSPACE_CONFLICT: 'Có thao tác đồng thời từ quản trị viên khác. Đã tải lại; vui lòng kiểm tra trạng thái trước khi thử lại.',
  LEARNING_DRAFT_EXPIRED: 'Bản nháp đã quá 30 ngày không được xét duyệt. Không thể phê duyệt phiên bản này.',
  LEARNING_DRAFT_ALREADY_DECIDED: 'Bản nháp vừa được Admin khác xử lý. Đã tải lại trạng thái mới nhất.',
  LEARNING_DRAFT_REVISION_CONFLICT: 'Bản nháp vừa được cập nhật phiên bản mới. Đã tải lại — vui lòng xem lại trước khi quyết định.',
  LEARNING_DRAFT_HASH_CONFLICT: 'Nội dung bản nháp đã thay đổi. Đã tải lại.',
  LEARNING_TENANT_SCOPE_NOT_VERIFIED: 'Cần xác minh phạm vi tổ chức cho phiên bản hiện tại trước khi phê duyệt.',
  LEARNING_TENANT_SCOPE_MISMATCH: 'Bản nháp không thuộc phạm vi tổ chức của bạn.', DEPARTMENT_NOT_IN_TENANT: 'Phòng ban của bản nháp không thuộc tổ chức của bạn.',
  LEARNING_DEPARTMENT_SCOPE_REQUIRED: 'Bản nháp chưa có phạm vi phòng ban, không thể xác minh.',
  LEARNING_RULE_NOT_EFFECTIVE: 'Quy tắc được trích dẫn không còn hiệu lực. Không thể phê duyệt.', LEARNING_RULE_CITATION_INVALID: 'Trích dẫn quy tắc không còn khớp với tài liệu gốc.',
  LEARNING_RULE_CITATION_REQUIRED: 'Bản nháp chưa trích dẫn quy tắc nào.', LEARNING_REGRESSION_FAILED: 'Kiểm thử hồi quy không đạt. Xem chi tiết bên phải.',
  LEARNING_DRAFT_SENSITIVE_CONTENT: 'Nội dung có dấu hiệu chứa thông tin định danh (số điện thoại, email…). Vui lòng xóa trước khi lưu.',
  LEARNING_REJECT_REASON_REQUIRED: 'Vui lòng nhập lý do từ chối.', LEARNING_CHANGE_NOTE_REQUIRED: 'Vui lòng nhập nội dung cần chỉnh sửa.',
  QC_FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.', APPROVED_RETENTION_POLICY_REQUIRED: 'Chưa có chính sách lưu trữ được duyệt trong Cài đặt.', PURGE_REASON_REQUIRED: 'Vui lòng nhập lý do dọn dữ liệu.',
  LEARNING_DRAFT_NOT_FOUND: 'Bản nháp không còn tồn tại hoặc bạn không có quyền xem.', LEARNING_SANDBOX_TRIGGER_DISABLED_WITH_REAL_DATA: 'Chỉ chạy thử được khi hệ thống dùng dữ liệu thử nghiệm.',
};
const message = (e: unknown) => { const r = e as { response?: { status?: number; data?: { error?: string } } }; const code = r.response?.data?.error; return r.response?.status === 404 && !code ? 'Tính năng chưa sẵn sàng trên máy chủ hiện tại.' : ERRORS[code ?? ''] ?? qcError(code); };
const conflict = (e: unknown) => (e as { response?: { status?: number } }).response?.status === 409;

async function load() {
  try { items.value = (await qcRequest<{ items: LearningDraftItem[] }>('get', '/learning-drafts')).items; error.value = ''; }
  catch (e) { items.value = []; error.value = message(e); }
}
async function loadHealth() {
  if (!props.canDecide) { health.value = null; return; }
  try { health.value = await qcRequest<LearningHealth>('get', '/learning-drafts/health'); } catch { health.value = null; }
}
async function purge() {
  if (busy.value || !purgeReason.value.trim()) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    const r = await qcRequest<LearningPurgeResult>('post', '/learning-drafts/purge-expired', { reason: purgeReason.value });
    notice.value = r.deleted || r.minimised ? `Đã dọn ${r.deleted} bản nháp, xóa bằng chứng của ${r.minimised} bài học đã duyệt.${r.outboxFiles.length ? ` Còn ${r.outboxFiles.length} tệp trong thư mục Obsidian chờ đồng bộ cần quản trị hệ thống xóa thủ công.` : ''}` : 'Không có dữ liệu nào quá thời gian lưu trữ.';
    purgeDialog.value = false; purgeReason.value = '';
    await Promise.all([load(), loadHealth()]); emit('changed', 'draft');
  } catch (e) { error.value = message(e); } finally { busy.value = false; }
}
async function reloadDetail() { if (!detail.value) return; try { detail.value = await qcRequest<LearningDraftDetail>('get', `/learning-drafts/${detail.value.id}`); } catch { detail.value = null; dialog.value = false; } }
async function open(id: string) {
  busy.value = true; error.value = ''; confirm.value = false; note.value = '';
  try { detail.value = await qcRequest<LearningDraftDetail>('get', `/learning-drafts/${id}`); revision.value = { title: detail.value.title, rationale: detail.value.rationale }; dialog.value = true; }
  catch (e) { error.value = message(e); } finally { busy.value = false; }
}
async function act(action: 'verify-scope' | 'approve' | 'reject' | 'request-changes' | 'revise', payload: Record<string, unknown>) {
  if (!detail.value || busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  const done: Record<typeof action, string> = { 'verify-scope': 'Đã xác minh phạm vi tổ chức.', approve: 'Đã phê duyệt. Bài học được đưa vào kho truy xuất dưới dạng tình huống tham chiếu.', reject: 'Đã từ chối bản nháp.', 'request-changes': 'Đã gửi yêu cầu chỉnh sửa.', revise: 'Đã lưu phiên bản mới. Cần xác minh phạm vi lại trước khi duyệt.' };
  try {
    await qcRequest('post', `/learning-drafts/${detail.value.id}/${action}`, { expectedRevision: detail.value.revision, ...payload });
    notice.value = done[action]; note.value = ''; confirm.value = false;
    await Promise.all([load(), reloadDetail()]);
    emit('changed', action === 'approve' ? 'decision' : 'draft');
    if (['approve', 'reject', 'request-changes'].includes(action)) dialog.value = false;
  } catch (e) {
    error.value = message(e);
    if (conflict(e) || (e as { response?: { status?: number } }).response?.status === 422) await Promise.all([load(), reloadDetail()]);
  } finally { busy.value = false; }
}
async function runSandbox() {
  busy.value = true; error.value = '';
  try { const r = await qcRequest<{ created: number; merged: number }>('post', '/learning-drafts/sandbox/nightly-run', {}); notice.value = `Chạy thử xong: ${r.created} bản nháp mới, ${r.merged} bản nháp được bổ sung.`; await load(); emit('changed', 'draft'); }
  catch (e) { error.value = message(e); } finally { busy.value = false; }
}
// Realtime/polling signal from the parent: another Admin decided or the nightly job ran → reload, never keep stale state.
watch(() => props.revision, () => { void load(); void loadHealth(); if (dialog.value) void reloadDetail(); }, { immediate: true });
watch(() => props.canDecide, () => void loadHealth());
</script>

<style scoped>
.learning{border:1px solid rgba(127,145,175,.2);border-radius:14px;background:rgb(var(--v-theme-surface));margin-bottom:20px;overflow:hidden}
.learning.has-pending{border-color:rgba(var(--v-theme-primary),.3);box-shadow:inset 3px 0 0 rgb(var(--v-theme-primary))}
.learning-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:18px 20px 10px}
.learning-title{display:flex;gap:12px;align-items:flex-start;min-width:0}
.learning-bell{width:36px;height:36px;flex-shrink:0;border-radius:10px;display:grid;place-items:center;background:rgba(var(--v-theme-primary),.1);color:rgb(var(--v-theme-primary))}
.learning h3{font-size:15px;font-weight:650;display:flex;align-items:center;flex-wrap:wrap;gap:8px}
.learning-head p{font-size:13px;color:#758096;margin-top:2px;max-width:70ch}
.learning-count{font-size:11px;font-weight:700;background:rgb(var(--v-theme-primary));color:#fff;padding:1px 9px;border-radius:999px}
.learning-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.live-pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#2f8a6f;padding:2px 9px;border-radius:999px;background:rgba(45,153,119,.08)}
.live-pill i{width:6px;height:6px;border-radius:50%;background:currentColor}
.learning-legend{display:flex;flex-wrap:wrap;gap:6px 18px;padding:0 20px 12px 68px;font-size:12px;color:#758096}
.learning-legend span{display:inline-flex;align-items:center;gap:6px}
.dot{width:8px;height:8px;border-radius:2px;display:inline-block}.dot.policy{background:#2f8a6f}.dot.case{background:#5977d5}.dot.draft{background:#d79a2b}
.learning-filter{display:flex;gap:6px;padding:0 20px 12px;flex-wrap:wrap}
.learning-filter button{border:1px solid rgba(127,145,175,.25);background:transparent;color:inherit;border-radius:999px;padding:4px 12px;font-size:12px;cursor:pointer;display:inline-flex;gap:6px;font-family:inherit}
.learning-filter button.active{background:rgba(var(--v-theme-primary),.1);border-color:rgba(var(--v-theme-primary),.4);color:rgb(var(--v-theme-primary))}
.learning-filter button:focus-visible,.learning-link:focus-visible{outline:2px solid #5977d5;outline-offset:2px}
.learning-table{border-top:1px solid rgba(127,145,175,.15)}
.learning-table td{vertical-align:top;padding-top:10px!important;padding-bottom:10px!important;font-size:13px}
.learning-link{background:transparent;border:0;padding:0;color:inherit;font:inherit;font-weight:600;text-align:left;cursor:pointer}
.learning-link:hover{color:rgb(var(--v-theme-primary))}
.muted{font-size:12px;color:#758096}.num{text-align:right;font-variant-numeric:tabular-nums}.action{text-align:right;white-space:nowrap}
.source-chip{display:inline-flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap}
.learning-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:22px;color:#758096;font-size:13px}
.dialog-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:20px 24px 8px!important;white-space:normal}
.dialog-head h2{font-size:18px;font-weight:650;line-height:1.4;margin-top:4px}
.eyebrow{font-size:10px;font-weight:650;letter-spacing:1px;color:#758096}
.dialog-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:12px;color:#758096;margin-top:8px}
.detail-grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:24px}
.detail-main section{margin-bottom:20px}.detail-main h4{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:650;margin-bottom:6px}
.detail-main p{font-size:13px;line-height:1.6}
.evidence code{font-size:11px}
.rule-card{border:1px solid rgba(127,145,175,.2);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.rule-top{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.rule-card blockquote{margin-top:6px;padding-left:10px;border-left:3px solid rgba(127,145,175,.35);font-size:13px}
.raw pre{white-space:pre-wrap;font-size:12px;background:rgba(127,145,175,.08);padding:10px;border-radius:8px;margin-top:6px}
.history{list-style:none;padding:0}.history li{display:grid;grid-template-columns:130px 1fr;gap:2px 10px;font-size:13px;padding:6px 0;border-bottom:1px dashed rgba(127,145,175,.2)}
.history time{color:#758096;font-size:12px;grid-row:span 3}.history p{grid-column:2}
.detail-side{border-left:1px solid rgba(127,145,175,.18);padding-left:20px}
.step{display:flex;gap:10px;margin-bottom:14px}.step>span{width:22px;height:22px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:rgba(127,145,175,.15)}
.step.done>span{background:rgba(45,153,119,.15);color:#2f8a6f}.step strong{font-size:13px}.step p{margin:2px 0 6px}
.ok{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#2f8a6f}
.side-actions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.side-note{font-size:13px;line-height:1.6;color:#758096}
.regression{margin-top:14px;font-size:12px}.regression ul{list-style:none;padding:0;margin-top:4px}.regression li{display:flex;gap:6px;align-items:center;padding:2px 0}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
@media(max-width:850px){.detail-grid{grid-template-columns:1fr}.detail-side{border-left:0;border-top:1px solid rgba(127,145,175,.18);padding:16px 0 0}.learning-legend{padding-left:20px}}
@media(max-width:700px){.learning-head{flex-direction:column}.learning-table th:nth-child(3),.learning-table td:nth-child(3),.learning-table th:nth-child(4),.learning-table td:nth-child(4){display:none}.history li{grid-template-columns:1fr}.history time{grid-row:auto}}
.learning-health{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 20px 10px;font-size:12px;color:#5b6577}.health-dot{width:8px;height:8px;border-radius:50%;background:#9aa3b2}.health-dot.on{background:#2f8a6f}.health-warn{color:#b26a00;font-weight:600}.learning-purge{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin:0 20px 10px;font-size:12px}
</style>
