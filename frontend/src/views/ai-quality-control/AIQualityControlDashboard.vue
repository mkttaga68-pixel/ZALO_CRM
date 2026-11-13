<template>
  <v-container fluid class="qc-page">
    <header class="qc-header">
      <div class="qc-heading">
        <span class="qc-brand-icon"><v-icon size="24">mdi-shield-check-outline</v-icon></span>
        <div class="qc-heading-text">
          <h1>Kiểm soát chất lượng AI</h1>
          <p>Theo dõi hội thoại, xem xét bằng chứng và nâng cao chất lượng phục vụ.</p>
          <div class="qc-context-chips">
            <span :class="['qc-mode', !status ? 'mode-neutral' : status.syntheticOnly ? 'mode-test' : 'mode-live']"><i />{{ !status ? 'Đang tải trạng thái' : status.syntheticOnly ? 'Dữ liệu thử nghiệm' : 'Dữ liệu CRM' }}</span>
            <span class="qc-chip-sep" aria-hidden="true" />
            <span class="qc-review-note"><v-icon size="14">mdi-account-check-outline</v-icon>Kết quả AI cần người duyệt</span>
            <template v-if="status?.storageMode==='memory'"><span class="qc-chip-sep" aria-hidden="true" /><span class="qc-review-note"><v-icon size="14">mdi-information-outline</v-icon>Dữ liệu thử chỉ lưu trong phiên</span></template>
          </div>
        </div>
      </div>
      <div class="qc-header-actions"><v-btn variant="outlined" prepend-icon="mdi-refresh" :loading="busy" @click="refresh">Làm mới</v-btn><v-btn color="primary" variant="flat" prepend-icon="mdi-plus" :disabled="!workspace || !can('create')" @click="tab=1">Phân tích hội thoại</v-btn></div>
    </header>
    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-4" @click:close="error=''">{{ error }}</v-alert>
    <v-alert v-if="notice" type="success" variant="tonal" closable class="mb-4" @click:close="notice=''">{{ notice }}</v-alert>
    <AIWarningCenter v-if="monitoringBuildEnabled && status?.syntheticOnly && workspace" :permissions="workspace.permissions" />
    <nav class="qc-nav">
      <v-tabs v-model="tab" show-arrows color="primary" class="qc-tabs">
        <template v-for="(item, index) in navigation" :key="item.value">
          <span v-if="index > 0 && item.group !== navigation[index-1].group" class="qc-tab-divider" aria-hidden="true" />
          <v-tab :value="item.value"><v-icon size="18" class="mr-2">{{ item.icon }}</v-icon>{{ item.label }}<span v-if="item.value===8 && pendingCount" class="qc-tab-count">{{ pendingCount }}</span><span v-if="item.value===11 && learningPending" class="qc-tab-count" :aria-label="`${learningPending} bài học AI chờ duyệt`">{{ learningPending }}</span></v-tab>
        </template>
      </v-tabs>
      <v-progress-linear v-if="busy" indeterminate color="primary" height="2" class="qc-nav-progress" aria-label="Đang xử lý" />
    </nav>
    <div v-if="!workspace && !busy" class="qc-empty"><v-icon size="40" class="mb-4">mdi-cloud-alert-outline</v-icon><h2>Chưa tải được dữ liệu</h2><p>Vui lòng làm mới hoặc liên hệ quản trị viên để kiểm tra kết nối.</p><v-btn class="mt-4" variant="tonal" @click="refresh">Thử lại</v-btn></div>
    <div v-if="!workspace && busy" class="qc-loading"><v-skeleton-loader type="heading, paragraph, card, table" /></div>
    <template v-if="workspace">
      <ObserverInbox v-if="status?.manualRealTest" v-show="tab===0 || tab===8" :revision="observationRevision" />
      <section v-if="tab===0">
        <QualityOverview :workspace="workspace" :status="status" @navigate="tab=$event" @open="openRun" />
      </section>

      <section v-if="tab===1 || tab===8" class="mt-5">
        <ManualCrmAnalysis v-if="tab===1 && status?.manualRealTest" :permissions="workspace.permissions" :retention-days="workspace.settings.retentionDays" :provider="status?.manualProvider ?? 'openai'" :api-ready="status?.manualProvider === 'ollama' ? !!status?.provider.ollamaAvailable : !!status?.provider.realApiEnabled && !!status?.provider.apiKeyConfigured && !!status?.provider.outboundTestApproved" @refresh="refresh" @run="selectedRun=$event;runDialog=true;refresh()" />
        <v-expansion-panels v-if="tab===1 && !status?.manualRealTest" class="mb-4"><v-expansion-panel title="Chọn hội thoại CRM"><v-expansion-panel-text><p>Chỉ hiển thị hội thoại bạn được phép truy cập.</p><v-btn variant="outlined" :disabled="busy || status?.syntheticOnly" @click="loadCrm">Tải danh sách được phép</v-btn><v-select v-model="crmId" :items="crmConversations" item-title="title" item-value="id" label="Chọn hội thoại" /><v-btn :disabled="busy || status?.syntheticOnly || !crmId || !can('create')" @click="analyzeCrm">Phân tích hội thoại đã chọn</v-btn></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
        <v-card variant="outlined" class="pa-4 mb-4"><v-row align="center"><v-col cols="12" sm="4"><v-select v-model="filters.employeeId" label="Nhân viên (đã xác minh)" :items="workspace.employees.map(id=>({title:workspace?.employeeNames?.[id] ?? id,value:id}))" clearable hide-details /></v-col><v-col cols="12" sm="3"><v-text-field v-model="filters.from" type="datetime-local" label="Từ" hide-details /></v-col><v-col cols="12" sm="3"><v-text-field v-model="filters.to" type="datetime-local" label="Đến" hide-details /></v-col><v-col><v-btn :disabled="busy" @click="refresh">Lọc</v-btn></v-col></v-row></v-card>
        <v-table><thead><tr><th>Thời điểm</th><th>Nguồn / Mô hình</th><th>Kết quả</th><th>Xét duyệt</th><th></th></tr></thead><tbody>
          <tr v-for="run in filteredRuns" :key="run.id"><td>{{ displayTime(run.createdAt) }}</td><td>{{ qcLabel(run.conversation.source) }}<div class="text-caption">{{ qcLabel(run.provider) }}</div></td><td><v-chip :color="qcTone(run.status)" variant="tonal">{{ qcLabel(run.status) }}</v-chip><div class="text-caption mt-1">{{ run.output.findings.filter(f=>f.status==='POTENTIAL_ISSUE').length }} nhận xét cần xem</div></td><td><v-chip :color="qcTone(run.reviewStatus)" variant="tonal">{{ qcLabel(run.reviewStatus) }}</v-chip></td><td><v-btn size="small" variant="text" @click="openRun(run.id)">Xem bằng chứng</v-btn></td></tr>
          <tr v-if="!filteredRuns.length"><td colspan="5" class="qc-empty">Chưa có kết quả phù hợp với bộ lọc.</td></tr>
        </tbody></v-table>
      </section>


      <section v-if="tab===3" class="mt-5"><v-alert type="info" variant="tonal" class="mb-3">Tỷ lệ phản hồi được tính trên các lượt hỏi đủ điều kiện, có nhân viên trả lời.</v-alert><v-table><thead><tr><th>Phân tích</th><th>Trạng thái / thiếu</th><th>Trả lời / đủ điều kiện</th><th>Trung vị / Mốc 90% (giây)</th><th>Phản hồi / Đúng hạn</th></tr></thead><tbody><tr v-for="r in workspace.runs" :key="r.id"><td><v-btn variant="text" @click="openRun(r.id)">{{ r.id.slice(0,8) }}</v-btn></td><td>{{ qcLabel(r.metrics.status) }}<div>{{ r.metrics.reason ? qcLabel(r.metrics.reason) : '' }}</div></td><td>{{ r.metrics.answeredTurns }} / {{ r.metrics.eligibleTurns }}</td><td>{{ r.metrics.medianSeconds ?? '—' }} / {{ r.metrics.p90Seconds ?? '—' }}</td><td>{{ percentage(r.metrics.responseRate) }} / {{ percentage(r.metrics.slaCompliance) }}</td></tr><tr v-if="!workspace.runs.length"><td colspan="5" class="qc-empty">Chưa có dữ liệu.</td></tr></tbody></v-table></section>


      <section v-if="tab===10" class="mt-5"><DepartmentMonitoringSettings :can-edit="can('edit') && can('approve')" @refresh="refresh" /></section>

      <section v-if="tab===5" class="mt-5">
        <v-card variant="flat" class="qc-vault mb-5">
          <div class="qc-vault-head">
            <div class="qc-vault-icon"><v-icon size="24">mdi-bookshelf</v-icon></div>
            <div class="qc-vault-title"><h2>Kho quy tắc<button v-if="learningEnabled" type="button" :class="['qc-learning-bell',{active:learningPending>0}]" :aria-label="learningPending ? `${learningPending} bài học AI chờ duyệt — xem danh sách` : 'Không có bài học AI chờ duyệt'" :title="learningPending ? `${learningPending} bài học AI chờ duyệt` : 'Không có bài học AI chờ duyệt'" @click="tab=11"><v-icon size="18">{{ learningPending ? 'mdi-bell-ring' : 'mdi-bell-outline' }}</v-icon><span v-if="learningPending" class="qc-learning-badge">{{ learningPending }}</span></button></h2><p>Đồng bộ tài liệu từ Obsidian, kiểm tra nội dung và duyệt quy tắc trước khi áp dụng cho hội thoại.</p></div>
          </div>
          <div class="qc-vault-body">
            <div class="qc-vault-path">
              <v-text-field v-model="settings.vaultPath" label="Thư mục tài liệu Obsidian" placeholder="/duong-dan/toi/vault" prepend-inner-icon="mdi-folder-outline" variant="outlined" density="comfortable" hide-details :disabled="!can('edit')" />
              <v-btn variant="tonal" height="48" prepend-icon="mdi-content-save-outline" :disabled="busy || !can('edit')" @click="saveSettings">Lưu đường dẫn</v-btn>
            </div>
            <ol class="qc-vault-steps">
              <li><span>1</span>Sửa tài liệu trong Obsidian</li>
              <li><span>2</span>Xem trước để kiểm tra lỗi</li>
              <li><span>3</span>Đồng bộ thành bản nháp</li>
              <li><span>4</span>Mở bản nháp, thiết lập và duyệt</li>
            </ol>
            <div class="qc-vault-actions">
              <v-btn variant="outlined" prepend-icon="mdi-eye-outline" :loading="busy" :disabled="busy || !can('edit') || !can('view_all')" @click="previewVault">Xem trước</v-btn>
              <v-btn color="primary" variant="flat" prepend-icon="mdi-sync" :loading="busy" :disabled="busy || !can('edit') || !can('view_all')" @click="syncVault">Đồng bộ bản nháp</v-btn>
            </div>
            <div v-if="previewSummary" class="qc-vault-preview" aria-live="polite">
              <div><small>Tài liệu tìm thấy</small><strong>{{ previewSummary.documents }}</strong></div>
              <div :class="{ warn: previewSummary.issues }"><small>Vấn đề cần xử lý</small><strong>{{ previewSummary.issues }}</strong></div>
              <div v-if="previewSummary.coverage"><small>Độ bao phủ</small><strong>{{ vaultCoverageLabel(previewSummary.coverage) }}</strong></div>
            </div>
            <v-alert v-if="!syncReport && previewIssues.length" type="warning" variant="tonal" density="compact" class="mt-3 qc-issue-list"><strong>{{ previewIssues.length }} tệp sẽ bị bỏ qua khi đồng bộ:</strong><ul><li v-for="i in previewIssues.slice(0,10)" :key="i.path"><code>{{ i.path }}</code> — {{ vaultIssueLabels[i.code] ?? i.code }}</li></ul><span v-if="previewIssues.length>10">…và {{ previewIssues.length-10 }} tệp khác.</span></v-alert>
            <div v-if="syncReport" class="qc-sync-report" aria-live="polite">
              <div class="qc-vault-preview">
                <div><small>Tài liệu mới</small><strong>{{ syncReport.added }}</strong></div>
                <div><small>Cập nhật thành bản nháp mới</small><strong>{{ syncReport.updated }}</strong></div>
                <div><small>Không đổi</small><strong>{{ syncReport.unchanged }}</strong></div>
                <div><small>Bản nháp cũ đã dọn</small><strong>{{ syncReport.pruned }}</strong></div>
              </div>
              <v-alert v-if="syncReport.issues.length" type="warning" variant="tonal" density="compact" class="mt-3 qc-issue-list"><strong>{{ syncReport.issues.length }} tệp bị bỏ qua, đồng bộ chưa đầy đủ:</strong><ul><li v-for="i in syncReport.issues.slice(0,10)" :key="i.path"><code>{{ i.path }}</code> — {{ vaultIssueLabels[i.code] ?? i.code }}</li></ul><span v-if="syncReport.issues.length>10">…và {{ syncReport.issues.length-10 }} tệp khác.</span></v-alert>
              <v-alert v-if="syncReport.missing.length" type="info" variant="tonal" density="compact" class="mt-3 qc-issue-list"><strong>{{ syncReport.missing.length }} tài liệu trong Kho không còn trong thư mục Obsidian.</strong> Tài liệu đã duyệt vẫn được áp dụng cho tới khi bạn thu hồi.<ul><li v-for="m in syncReport.missing.slice(0,10)" :key="m.sourcePath"><code>{{ m.sourcePath }}</code> — {{ qcLabel(m.status) }}<strong v-if="m.active" class="qc-missing-active"> · đang áp dụng, cần thu hồi</strong></li></ul><span v-if="syncReport.missing.length>10">…và {{ syncReport.missing.length-10 }} tài liệu khác.</span></v-alert>
              <p :class="['qc-capacity',{warn:syncReport.capacity.documents>=syncReport.capacity.limit*0.8}]"><v-icon size="14">mdi-database-outline</v-icon>Dung lượng kho: {{ syncReport.capacity.documents }} / {{ syncReport.capacity.limit }} phiên bản<span v-if="syncReport.capacity.documents>=syncReport.capacity.limit*0.8"> · sắp đầy, nên thu hồi/dọn các phiên bản không còn dùng</span></p>
            </div>
            <details class="qc-details"><summary>Thông tin kỹ thuật</summary><pre class="qc-json">{{ vaultPreview ? pretty(vaultPreview) : 'Chọn “Xem trước” để xem chi tiết kết quả quét thư mục.' }}</pre></details>
          </div>
        </v-card>
        <KnowledgeDocumentLibrary :documents="workspace.documents" :selected="document" :can-approve="can('approve')" @select="selectDocument">
          <template #detail><div v-if="document" class="doc-layout"><section class="doc-reading"><div class="doc-section-heading"><v-icon size="17">mdi-text-box-outline</v-icon><h3>Nội dung tài liệu</h3></div><KnowledgeDocumentPreview :markdown="document.markdown" /><details class="doc-source"><summary>Xem Markdown gốc và mã xác thực</summary><pre class="doc-raw">{{ document.markdown }}</pre><p class="qc-hash">SHA-256 {{ document.contentHash }}</p></details></section>
            <aside class="doc-config"><div class="doc-section-heading"><v-icon size="17">mdi-tune-variant</v-icon><h3>Thiết lập quy tắc</h3></div><p class="doc-config-note">Cấu hình loại đánh giá, thời gian và phạm vi áp dụng.</p>
            <v-alert v-if="document.sourceMissingAt" type="warning" variant="tonal" density="compact" class="mb-4 doc-missing">{{ document.status==='DRAFT' ? 'Tệp nguồn của bản nháp này đã bị xoá khỏi Obsidian nên không thể duyệt. Khôi phục tệp rồi đồng bộ lại nếu vẫn cần.' : 'Tệp nguồn đã bị xoá khỏi Obsidian.' + (document.status==='APPROVED' ? ' Quy tắc này vẫn được AI áp dụng cho tới khi bạn thu hồi.' : '') }}</v-alert>
            <template v-if="document.status==='DRAFT' && can('approve') && !document.sourceMissingAt"><v-text-field v-model="publication.ruleId" label="Mã quy tắc" /><v-select v-model="publication.type" :items="analysisOptions" label="Loại phân tích (bắt buộc)" placeholder="Chọn loại phân tích" :hint="publicationTypeHint" persistent-hint class="mb-2" /><v-text-field v-model="publication.terms" label="Từ khóa đối chiếu (ngăn cách bằng |)" /><v-text-field v-model="publication.conflictGroup" label="Nhóm quy tắc liên quan (tùy chọn)" /><v-text-field v-model="publication.effectiveFrom" type="datetime-local" label="Có hiệu lực từ (bắt buộc)" /><v-text-field v-model="publication.effectiveTo" type="datetime-local" label="Hết hiệu lực (tùy chọn)" /><v-text-field v-model="publication.departments" label="Mã phòng ban (dấu phẩy; trống = toàn tổ chức)" /><v-text-field v-model="publication.sla" type="number" label="Thời hạn phản hồi (giây làm việc)" /><v-checkbox v-model="publication.confirmed" :disabled="!publication.type" :label="publication.type ? `Tôi xác nhận có thẩm quyền duyệt nội dung, phạm vi, thời gian áp dụng, và đây là quy tắc loại «${typeTitle(publication.type)}»` : 'Chọn loại phân tích trước khi xác nhận'" /><v-btn :disabled="busy || !publication.type || !publication.confirmed || !publication.effectiveFrom || !publication.ruleId" @click="publishDocument">Duyệt và xuất bản</v-btn></template>
            <p v-if="document.approvedAt">Hiệu lực: {{ document.effectiveFrom }} → {{ document.effectiveTo || 'Không đặt ngày kết thúc' }}<span v-if="document.status==='APPROVED' && document.effectiveFrom && Date.parse(document.effectiveFrom)>Date.now()"> · Chưa đến ngày hiệu lực</span></p>
            <v-btn v-if="document.status==='APPROVED' && can('approve')" color="warning" variant="outlined" :disabled="busy" @click="revokeDocument">Thu hồi tài liệu này</v-btn>
            <p v-if="document.status!=='DRAFT' || !can('approve')" class="doc-config-note">{{ document.status==='APPROVED' ? 'Tài liệu đã được duyệt. Để thay đổi nội dung, sửa bản nguồn và đồng bộ phiên bản mới.' : document.status==='DRAFT' ? 'Bạn có thể xem nội dung. Việc thiết lập và duyệt cần quyền phê duyệt.' : 'Phiên bản này không thể xuất bản. Đồng bộ tài liệu nguồn để tạo bản nháp mới.' }}</p></aside>
          </div></template>
        </KnowledgeDocumentLibrary>
      </section>

      <!-- AIQC Nightly Learning: trang riêng cho Admin (approve) duyệt bài học AI đề xuất. -->
      <section v-if="tab===11 && learningEnabled" class="mt-5">
        <LearningDraftInbox :revision="learning.revision.value" :live="learning.live.value" :pending="learningPending" :can-decide="can('approve')&&can('view_all')" :can-revise="can('edit')&&can('approve')&&can('view_all')" :can-sandbox="can('edit')&&can('view_all')" :can-purge="can('delete')&&can('view_all')" :synthetic-only="!!status?.syntheticOnly" :names="workspace.employeeNames ?? {}" @changed="onLearningChanged" />
      </section>
      <!-- Lưu trữ tin nhắn khách hàng. -->
      <section v-if="tab===12" class="mt-5"><CustomerMessageArchive /></section>

      <section v-if="tab===7" class="mt-5"><v-card variant="outlined" class="pa-5"><h2>Trợ lý quản lý</h2><p>Tra cứu nhận xét và bằng chứng trong phạm vi bạn được phép xem.</p><v-textarea v-model="question" label="Bạn muốn tìm hiểu điều gì?" placeholder="Ví dụ: Những hội thoại nào cần xem xét?" class="mt-4" /><div class="d-flex ga-2"><v-btn :disabled="busy || !question.trim()" @click="ask('mock')">Tìm bằng chứng</v-btn><v-btn v-if="!status?.provider.openAiRemoved" variant="outlined" :disabled="busy || !question.trim() || !can('create') || !outboundAllowed" @click="ask('openai')">Hỏi bằng AI</v-btn></div><div v-if="assistantAnswer" class="qc-evidence" style="white-space:pre-wrap">{{ assistantText }}</div></v-card></section>

      <section v-if="tab===9" class="mt-5"><v-card variant="outlined" class="pa-5"><h2>Cấu hình phân tích</h2><v-alert v-if="status?.provider.openAiRemoved" type="info" variant="tonal" class="my-4">Phân tích hội thoại sử dụng AI cục bộ. Dữ liệu được xử lý trên máy chủ CRM.</v-alert><v-alert v-if="!status?.provider.openAiRemoved" type="info" variant="tonal" class="my-4">Kết nối AI: {{ status?.provider.apiKeyConfigured ? 'Đã cấu hình' : 'Chưa cấu hình' }}.</v-alert><v-select v-model="settings.provider" :items="(status?.provider.openAiRemoved ? ['mock'] : ['mock','openai']).map(value=>({title:qcLabel(value),value}))" label="Chế độ phân tích mặc định" /><v-select v-if="!status?.provider.openAiRemoved" v-model="settings.model" :items="status?.provider.models ?? []" label="Mô hình được phép sử dụng" clearable /><v-text-field v-model.number="settings.maxOutputTokens" type="number" label="Giới hạn độ dài kết quả (256–4096 token)" /><v-text-field v-model.number="settings.requestsPerMinute" type="number" label="Số yêu cầu tối đa mỗi phút" /><v-text-field v-model.number="settings.dailyTokenBudget" type="number" label="Ngân sách token/ngày theo tổ chức" /><v-text-field v-model="retention" type="number" label="Thời gian lưu chứng cứ (ngày)" :disabled="!can('approve')" /><div class="d-flex ga-2"><v-btn :disabled="busy || !can('edit')" @click="saveSettings">Lưu cài đặt</v-btn><v-btn v-if="!status?.provider.openAiRemoved" variant="outlined" :disabled="busy || !can('edit') || !outboundAllowed" @click="testConnection">Kiểm tra bằng dữ liệu thử</v-btn></div><details class="qc-details"><summary>Thông tin kỹ thuật</summary><pre class="qc-json">{{ pretty(status?.provider) }}</pre></details><h3>Lịch sử kết nối và sử dụng</h3><details class="qc-details"><summary>Thông tin kỹ thuật</summary><pre class="qc-json">{{ pretty(workspace.connectionTests) }}</pre></details></v-card></section>
    </template>

    <v-dialog v-model="runDialog" max-width="1120" scrollable><v-card v-if="selectedRun"><v-card-title class="d-flex align-center">Chứng cứ phân tích<v-spacer /><v-btn variant="text" @click="runDialog=false">Đóng</v-btn></v-card-title><v-card-text>
      <p>{{ selectedRun.id }} · {{ qcLabel(selectedRun.status) }} · {{ qcLabel(selectedRun.reviewStatus) }}</p><p class="qc-hash">Mã xác thực {{ selectedRun.snapshotHash }}</p><p>{{ selectedRun.output.summary }}</p><v-alert v-if="selectedRun.missingContext.length" type="warning" variant="tonal">{{ selectedRun.missingContext.map(qcLabel).join(', ') }}</v-alert>
      <v-expansion-panels multiple class="my-4"><v-expansion-panel v-for="f in selectedRun.output.findings" :key="f.type" :title="`${qcLabel(f.type)} · ${qcLabel(f.status)}`"><v-expansion-panel-text><p>{{ f.explanation }}</p><p class="text-caption">Thiếu: {{ f.missingContext.map(qcLabel).join(', ') || '—' }}</p><div v-for="id in f.messageIds" :key="id" class="qc-evidence"><strong>{{ id }}</strong><p>{{ selectedRun.conversation.messages.find(m=>m.id===id)?.text }}</p></div><div v-for="c in f.citations" :key="`${c.documentId}:${c.byteStart}`" class="qc-evidence"><p>{{ c.documentId }} · phiên bản {{ c.revision }}</p><blockquote>{{ c.quote }}</blockquote><p class="qc-hash">{{ c.contentHash }}</p></div></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
      <v-table><thead><tr><th>Tin nhắn</th><th>Người gửi</th><th>Nội dung</th></tr></thead><tbody><tr v-for="m in selectedRun.conversation.messages" :key="m.id"><td>{{ displayTime(m.occurredAt) }}<div class="text-caption">{{ m.id }}</div></td><td>{{ qcLabel(m.role) }} / {{ qcLabel(m.attribution) }}<div>{{ m.actorId ? (workspace?.employeeNames?.[m.actorId] ?? m.actorId) : 'Chưa xác định' }}</div></td><td>{{ m.text }}</td></tr></tbody></v-table>
      <v-btn class="my-4" variant="outlined" :disabled="busy" @click="replay">Kiểm tra tính toàn vẹn</v-btn><pre v-if="replayResult" class="qc-json">{{ pretty(replayResult) }}</pre>
      <template v-if="can('approve')"><v-textarea v-model="reviewReason" label="Lý do xét duyệt" /><div class="d-flex ga-2 flex-wrap"><v-btn v-if="selectedRun.reviewStatus==='PENDING'" :disabled="busy || !reviewReason.trim()" @click="reviewRun('ACCEPTED_FOR_FOLLOWUP')">Cần theo dõi / trao đổi</v-btn><v-btn v-if="selectedRun.reviewStatus==='PENDING'" variant="outlined" :disabled="busy || !reviewReason.trim()" @click="reviewRun('DISMISSED')">Bác bỏ nhận xét</v-btn><v-btn v-else variant="outlined" :disabled="busy || !reviewReason.trim()" @click="reviewRun('PENDING')">Mở lại review</v-btn></div></template>
      <v-expansion-panels class="mt-4"><v-expansion-panel title="Thông tin kỹ thuật và lịch sử thao tác"><v-expansion-panel-text><pre class="qc-json">{{ pretty({usage:selectedRun.usage,metrics:selectedRun.metrics,audits:workspace?.audits}) }}</pre></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
    </v-card-text></v-card></v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import {computed,defineAsyncComponent,onMounted,ref,watch} from 'vue';
const ManualCrmAnalysis=defineAsyncComponent(()=>import('./ManualCrmAnalysis.vue'));
const AIWarningCenter=defineAsyncComponent(()=>import('./AIWarningCenter.vue'));
const DepartmentMonitoringSettings=defineAsyncComponent(()=>import('./DepartmentMonitoringSettings.vue'));
const QualityOverview=defineAsyncComponent(()=>import('./QualityOverview.vue'));
const ObserverInbox=defineAsyncComponent(()=>import('./ObserverInbox.vue'));
const KnowledgeDocumentLibrary=defineAsyncComponent(()=>import('./KnowledgeDocumentLibrary.vue'));
const KnowledgeDocumentPreview=defineAsyncComponent(()=>import('./KnowledgeDocumentPreview.vue'));
const LearningDraftInbox=defineAsyncComponent(()=>import('./LearningDraftInbox.vue'));
const CustomerMessageArchive=defineAsyncComponent(()=>import('./CustomerMessageArchive.vue'));
import {useLearningDraftSignal} from './learning-signal';
const observationRevision=ref(0);
import { analysisOptions, qcLabel, qcTone, qcError, vaultIssueLabels, vaultCoverageLabel } from './presentation';
import {documentGroup,documentRuleId} from './knowledge-groups';
const monitoringBuildEnabled=import.meta.env.VITE_AI_QC_MONITORING_ENABLED==='true';
import {qcRequest,type QcWorkspace,type QcStatus,type QcSettings,type QcRun,type QcDocument} from '@/api/ai-quality-control';
// Nhóm "work": việc theo dõi hằng ngày · nhóm "setup": cấu hình nền tảng chấm điểm.
const navigationItems=[{value:0,group:'work',label:'Tổng quan',icon:'mdi-view-dashboard-outline'},{value:8,group:'work',label:'Chờ duyệt',icon:'mdi-clipboard-check-outline'},{value:1,group:'work',label:'Hội thoại',icon:'mdi-message-text-outline'},{value:3,group:'work',label:'Phản hồi',icon:'mdi-timer-outline'},{value:7,group:'work',label:'Trợ lý AI',icon:'mdi-creation-outline'},{value:12,group:'work',label:'Lưu trữ tin nhắn',icon:'mdi-archive-outline'},{value:5,group:'setup',label:'Kho quy tắc',icon:'mdi-book-open-page-variant-outline'},{value:11,group:'setup',label:'Bài học AI',icon:'mdi-lightbulb-on-outline'},{value:10,group:'setup',label:'Phòng ban',icon:'mdi-account-group-outline'},{value:9,group:'setup',label:'Cài đặt',icon:'mdi-cog-outline'}];
const analysisTypes=['INSULT','COURTESY','UNRESOLVED_REQUEST','KNOWLEDGE_MISMATCH'];
const tab=ref(0),busy=ref(false),error=ref(''),notice=ref(''),workspace=ref<QcWorkspace|null>(null),status=ref<QcStatus|null>(null);
const settings=ref<QcSettings>({provider:'mock',model:'',vaultPath:'',maxOutputTokens:1000,requestsPerMinute:5,dailyTokenBudget:20000,retentionDays:null,inputUsdPerMillion:null,outputUsdPerMillion:null}),retention=ref('');
const filters=ref({employeeId:null as string|null,from:'',to:''});
const can=(action:string)=>workspace.value?.permissions.includes(action)??false;
const outboundAllowed=computed(()=>!!status.value?.provider.realApiEnabled&&!!status.value?.provider.outboundTestApproved&&!!status.value?.provider.apiKeyConfigured);
const pretty=(v:unknown)=>JSON.stringify(v,null,2),displayTime=(s:string)=>new Date(s).toLocaleString('vi-VN'),percentage=(n:number|null)=>n===null?'Chưa có dữ liệu':`${(n*100).toFixed(1)}%`;
// AIQC Nightly Learning: separate "Bài học AI" tab (value 11) for Admins (approve), badge on the tab and a shortcut bell in "Kho quy tắc". Realtime with polling fallback.
const learningEnabled=computed(()=>can('approve'));
const navigation=computed(()=>navigationItems.filter(item=>item.value!==11||learningEnabled.value));
watch(learningEnabled,on=>{if(!on&&tab.value===11)tab.value=5;});
const learning=useLearningDraftSignal(learningEnabled);
const learningPending=computed(()=>learning.summary.value?.pending??0);
// An approval adds a Verified Learning Case to the registry → reload documents; any change refreshes the badge.
function onLearningChanged(kind:'decision'|'draft'){learning.touch();if(kind==='decision')void load().catch(()=>{});}
watch(()=>learning.revision.value,()=>{if(tab.value===5&&!busy.value)void load().catch(()=>{});});
const pendingCount=computed(()=>workspace.value?.runs.filter(r=>r.reviewStatus==='PENDING').length??0);
const filteredRuns=computed(()=>workspace.value?.runs.filter(r=>tab.value!==8||r.reviewStatus==='PENDING').slice().reverse()??[]);
async function load(){
  const params={employeeId:filters.value.employeeId||undefined,from:filters.value.from?new Date(filters.value.from).toISOString():undefined,to:filters.value.to?new Date(filters.value.to).toISOString():undefined};
  const [s,w]=await Promise.all([qcRequest<QcStatus>('get','/status'),qcRequest<QcWorkspace>('get','/workspace',params)]);
  status.value=s;workspace.value=w;settings.value={...w.settings,...(s.provider.openAiRemoved&&w.settings.provider!=='ollama'?{provider:'mock' as const,model:''}:{})};retention.value=w.settings.retentionDays===null?'':String(w.settings.retentionDays);
  observationRevision.value++;
}
async function perform(fn:()=>Promise<void>){if(busy.value)return;busy.value=true;error.value='';notice.value='';try{await fn();}catch(e:unknown){const r=e as {response?:{status?:number;data?:{error?:string}}};const code=r.response?.data?.error;error.value=r.response?.status===404&&(!code||code==='not_found')?'Tính năng chưa sẵn sàng trên máy chủ hiện tại.':qcError(code);}finally{busy.value=false;}}
const refresh=()=>perform(load);
async function saveSettings(){await perform(async()=>{const payload={...settings.value,model:settings.value.model||''} as Record<string,unknown>;delete payload.retentionApprovedBy;if(can('approve'))payload.retentionDays=retention.value===''?null:Number(retention.value);else delete payload.retentionDays;await qcRequest('put','/settings',payload);await load();notice.value='Đã lưu cài đặt phân tích.';});}
const vaultPreview=ref<unknown>(null),document=ref<QcDocument|null>(null);
const previewSummary=computed(()=>{const p=vaultPreview.value as {documents?:unknown[];issues?:unknown;coverage?:unknown}|null;if(!p||!Array.isArray(p.documents))return null;const i=p.issues;const issues=Array.isArray(i)?i.length:i&&typeof i==='object'?Object.keys(i).length:0;return{documents:p.documents.length,issues,coverage:typeof p.coverage==='string'||typeof p.coverage==='number'?String(p.coverage):''};});
const publication=ref({ruleId:'',type:'INSULT',terms:'',conflictGroup:'',effectiveFrom:'',effectiveTo:'',departments:'',sla:'',confirmed:false});
// Loại phân tích không bao giờ tự gán mặc định: tài liệu chưa phân nhóm phải được người duyệt chọn rõ ràng.
const typeTitle=(type:string)=>analysisOptions.find(o=>o.value===type)?.title??type;
const publicationTypeHint=computed(()=>{const d=document.value;if(!d)return '';const g=documentGroup(d);return !publication.value.type?'Tài liệu chưa thuộc nhóm kiểm tra nào. Hãy chọn đúng loại trước khi duyệt.':g.suggested&&g.key===publication.value.type?'Gợi ý theo thư mục Obsidian — hãy kiểm tra lại trước khi duyệt.':'';});
watch(()=>publication.value.type,()=>{publication.value.confirmed=false;});
function selectDocument(d:QcDocument){const group=documentGroup(d);document.value=d;publication.value={ruleId:documentRuleId(d),type:analysisTypes.includes(group.key)?group.key:'',terms:d.rule?.matchTerms.join('|')??'',conflictGroup:d.rule?.conflictGroup??'',effectiveFrom:'',effectiveTo:'',departments:d.departmentIds.join(','),sla:d.rule?.slaSeconds==null?'':String(d.rule.slaSeconds),confirmed:false};}
const previewVault=()=>perform(async()=>{const p=await qcRequest<{documents:Array<{sourcePath:string;contentHash:string}>;issues:unknown;coverage:string}>('post','/knowledge/preview');syncReport.value=null;vaultPreview.value={documents:p.documents.map(d=>({sourcePath:d.sourcePath,contentHash:d.contentHash})),issues:p.issues,coverage:p.coverage};});
type SyncReport={added:number;updated:number;unchanged:number;scanned:number;pruned:number;missing:Array<{sourcePath:string;status:string;active?:boolean}>;issues:Array<{path:string;code:string}>;coverage:string;capacity:{documents:number;limit:number}};
const syncReport=ref<SyncReport|null>(null);
const previewIssues=computed(()=>{const i=(vaultPreview.value as {issues?:unknown}|null)?.issues;return Array.isArray(i)?i as Array<{path:string;code:string}>:[];});
const syncVault=()=>perform(async()=>{const r=await qcRequest<Partial<SyncReport>>('post','/knowledge/sync');
  // Máy chủ cũ chỉ trả {added,issues,coverage}: điền mặc định để vẫn hiển thị được.
  const report:SyncReport={added:r.added??0,updated:r.updated??0,unchanged:r.unchanged??0,scanned:r.scanned??0,pruned:r.pruned??0,missing:r.missing??[],issues:r.issues??[],coverage:r.coverage??'',capacity:r.capacity??{documents:0,limit:1000}};
  syncReport.value=report;await load();
  notice.value=`Đồng bộ xong: ${report.added} tài liệu mới, ${report.updated} cập nhật, ${report.unchanged} không đổi${report.pruned?`, đã dọn ${report.pruned} bản nháp cũ`:''}.`;});
const publishDocument=()=>perform(async()=>{if(!document.value)return;const p=publication.value;await qcRequest('post',`/knowledge/${document.value.id}/publish`,{hash:document.value.contentHash,effectiveFrom:new Date(p.effectiveFrom).toISOString(),effectiveTo:p.effectiveTo?new Date(p.effectiveTo).toISOString():null,departmentIds:p.departments.split(',').map(s=>s.trim()).filter(Boolean),rule:{id:p.ruleId,type:p.type,matchTerms:p.terms.split('|').map(s=>s.trim()).filter(Boolean),conflictGroup:p.conflictGroup||null,slaSeconds:p.sla===''?null:Number(p.sla),careIntervalDays:null}});document.value=null;await load();notice.value='Đã duyệt và xuất bản quy tắc.';});
const revokeDocument=()=>perform(async()=>{if(!document.value)return;await qcRequest('post',`/knowledge/${document.value.id}/revoke`,{hash:document.value.contentHash});document.value=null;await load();notice.value='Đã thu hồi. Lần phân tích mới không được dùng tài liệu này.';});
const question=ref(''),assistantAnswer=ref<unknown>(null),ask=(provider:'mock'|'openai')=>perform(async()=>{assistantAnswer.value=await qcRequest('post','/assistant',{question:question.value,provider});});
const assistantText=computed(()=>{const answer=assistantAnswer.value as {answer?:unknown}|null;return typeof answer?.answer==='string'?answer.answer:'Chưa có câu trả lời phù hợp.';});
const crmConversations=ref<Array<{id:string;title:string}>>([]),crmId=ref<string|null>(null);
const loadCrm=()=>perform(async()=>{crmConversations.value=(await qcRequest<{conversations:Array<{id:string;title:string}>}>('get','/crm/conversations')).conversations;});
const analyzeCrm=()=>perform(async()=>{if(!crmId.value)return;selectedRun.value=await qcRequest<QcRun>('post',`/crm/conversations/${crmId.value}/analyze`,{});runDialog.value=true;await load();});
const runDialog=ref(false),selectedRun=ref<QcRun|null>(null),replayResult=ref<unknown>(null),reviewReason=ref('');
const openRun=(id:string)=>perform(async()=>{selectedRun.value=await qcRequest<QcRun>('get',`/runs/${id}`);replayResult.value=null;reviewReason.value='';runDialog.value=true;});
const replay=()=>perform(async()=>{if(selectedRun.value)replayResult.value=await qcRequest('post',`/runs/${selectedRun.value.id}/replay`);});
const reviewRun=(decision:string)=>perform(async()=>{if(!selectedRun.value)return;selectedRun.value=await qcRequest<QcRun>('post',`/runs/${selectedRun.value.id}/review`,{expectedVersion:selectedRun.value.reviewVersion,decision,reason:reviewReason.value});reviewReason.value='';await load();});
const testConnection=()=>perform(async()=>{await qcRequest('post','/connection/test');await load();notice.value='Đã kiểm tra kết nối bằng dữ liệu thử nghiệm.';});
onMounted(refresh);
</script>

<style scoped>
.qc-page{--qc-muted:#6b7689;--qc-border:rgba(127,145,175,.2);max-width:1580px;padding:28px 32px 48px;color:rgb(var(--v-theme-on-surface))}.qc-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:0 0 24px}.qc-heading{display:flex;gap:16px;align-items:flex-start;min-width:0}.qc-heading-text{min-width:0}.qc-brand-icon{width:48px;height:48px;display:grid;place-items:center;flex-shrink:0;border-radius:14px;background:rgba(var(--v-theme-primary),.1);color:rgb(var(--v-theme-primary));margin-top:2px}.qc-header h1{font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.5px;color:rgb(var(--v-theme-on-surface))}.qc-header p{color:var(--qc-muted);margin-top:6px;font-size:14px;line-height:1.5}.qc-header-actions{display:flex;gap:10px;flex-shrink:0;padding-top:4px}.qc-page :deep(.v-btn){letter-spacing:0;text-transform:none;border-radius:10px;font-weight:600;box-shadow:none}.qc-header-actions :deep(.v-btn){height:40px;padding:0 16px;font-size:14px}.qc-header-actions :deep(.v-btn--variant-outlined){border-color:var(--qc-border);background:rgb(var(--v-theme-surface))}.qc-context-chips{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}.qc-chip-sep{width:3px;height:3px;border-radius:50%;background:var(--qc-border)}.qc-mode{display:inline-flex;gap:6px;align-items:center;border:1px solid transparent;border-radius:999px;font-size:12px;font-weight:600;padding:3px 10px;line-height:1.5}.qc-mode i{width:6px;height:6px;border-radius:100%;background:currentColor}.mode-live{background:rgba(45,153,119,.09);color:#2f8a6f;border-color:rgba(45,153,119,.16)}.mode-test{background:rgba(196,148,50,.09);color:#a8792a;border-color:rgba(196,148,50,.18)}.mode-neutral{background:rgba(127,145,175,.08);color:var(--qc-muted)}.qc-review-note{display:inline-flex;gap:5px;align-items:center;font-size:12px;color:var(--qc-muted)}.qc-nav{position:relative;border:1px solid var(--qc-border);background:rgb(var(--v-theme-surface));border-radius:14px;padding:0 6px;margin-bottom:24px;overflow:hidden}.qc-nav-progress{position:absolute!important;left:0;right:0;bottom:0}.qc-tabs{min-height:52px;height:52px}.qc-tabs :deep(.v-tab){text-transform:none;letter-spacing:0;font-size:14px;min-width:auto;padding:0 16px;font-weight:550;height:52px;color:var(--qc-muted)}.qc-tabs :deep(.v-tab:hover){color:rgb(var(--v-theme-on-surface))}.qc-tabs :deep(.v-tab--selected){color:rgb(var(--v-theme-primary));font-weight:650}.qc-tab-divider{align-self:center;flex-shrink:0;width:1px;height:22px;margin:0 8px;background:var(--qc-border)}.qc-tab-count{margin-left:8px;min-width:20px;height:20px;display:inline-grid;place-items:center;background:rgb(var(--v-theme-warning));color:#fff;border-radius:999px;padding:0 6px;font-size:11px;font-weight:700}.qc-page :deep(.v-card--variant-outlined){border:1px solid var(--qc-border);background:rgb(var(--v-theme-surface));border-radius:14px}.qc-page :deep(.v-field){border-radius:9px}.qc-page :deep(.v-alert){border-radius:10px;font-size:13px}.qc-page :deep(.v-table){border-radius:12px;font-size:13px}.qc-page :deep(.v-table th){font-size:12px!important;background:rgba(127,145,175,.04);color:var(--qc-muted)!important;font-weight:600!important}.qc-page :deep(.v-chip){font-size:11px;font-weight:550}.qc-empty{padding:55px 20px;text-align:center;color:var(--qc-muted);background:rgb(var(--v-theme-surface));border:1px dashed var(--qc-border);border-radius:14px}.qc-empty p{font-size:13px}.qc-loading{margin-top:20px}.qc-json,.qc-markdown{white-space:pre-wrap;overflow-wrap:anywhere;max-height:440px;overflow:auto;background:rgba(128,145,170,.05);padding:16px;margin:16px 0;border-radius:9px;font-size:12px}.qc-hash{font:11px monospace;overflow-wrap:anywhere;margin:12px 0;color:var(--qc-muted)}.qc-evidence{padding:12px;border-left:3px solid #9aace0;background:rgba(127,145,175,.05);margin:12px 0;overflow-wrap:anywhere}.qc-details{margin:16px 0;font-size:12px;color:var(--qc-muted)}.qc-details summary{cursor:pointer;padding:10px 0}h2{font-size:18px;margin-bottom:8px;font-weight:650}h3{font-size:15px}td{vertical-align:top;padding-top:14px!important;padding-bottom:14px!important}blockquote{white-space:pre-wrap;margin:10px 0}.qc-evidence strong{font-size:12px}
@media(max-width:1000px){.qc-header{flex-direction:column;gap:16px}.qc-header-actions{padding-top:0}}@media(max-width:650px){.qc-page{padding:18px 16px 32px}.qc-header-actions{flex-wrap:wrap;width:100%}.qc-header-actions :deep(.v-btn){flex:1}.qc-heading{gap:12px}.qc-brand-icon{width:40px;height:40px;border-radius:12px}.qc-header h1{font-size:20px}.qc-header p{font-size:13px}.qc-nav{margin-bottom:18px}.qc-tabs :deep(.v-tab){font-size:13px;padding:0 12px}.qc-tabs :deep(.v-tab .v-icon){display:none}}
.qc-vault{border:1px solid var(--qc-border)!important;border-radius:14px!important;background:rgb(var(--v-theme-surface))}.qc-vault-head{display:flex;gap:14px;align-items:center;padding:22px 24px;border-bottom:1px solid var(--qc-border)}.qc-vault-icon{width:44px;height:44px;flex-shrink:0;display:grid;place-items:center;border-radius:12px;background:rgba(var(--v-theme-primary),.09);color:rgb(var(--v-theme-primary))}.qc-vault-title h2{font-size:19px;font-weight:650}.qc-vault-title p{font-size:13px;color:var(--qc-muted);margin-top:4px}.qc-vault-body{padding:20px 24px 22px}.qc-vault-path{display:flex;gap:10px;align-items:center}.qc-vault-path .v-text-field{flex:1}.qc-vault-steps{list-style:none;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0;padding:0}.qc-vault-steps li{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--qc-muted);padding:10px 12px;border-radius:10px;background:rgba(127,145,175,.06)}.qc-vault-steps span{width:22px;height:22px;flex-shrink:0;display:grid;place-items:center;border-radius:50%;font-size:11px;font-weight:700;background:rgba(var(--v-theme-primary),.12);color:rgb(var(--v-theme-primary))}.qc-vault-actions{display:flex;gap:10px;flex-wrap:wrap}.qc-vault-actions .v-btn{height:40px!important}.qc-vault-preview{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:16px}.qc-vault-preview div{border:1px solid var(--qc-border);border-radius:10px;padding:10px 14px}.qc-vault-preview small{display:block;font-size:11px;color:var(--qc-muted)}.qc-vault-preview strong{font-size:20px}.qc-vault-preview .warn strong{color:rgb(var(--v-theme-warning))}.qc-vault .qc-details{margin-top:14px}
@media(max-width:900px){.qc-vault-steps{grid-template-columns:repeat(2,1fr)}}@media(max-width:650px){.qc-vault-head,.qc-vault-body{padding-left:16px;padding-right:16px}.qc-vault-path{flex-direction:column;align-items:stretch}.qc-vault-steps{grid-template-columns:1fr}.qc-vault-preview{grid-template-columns:1fr 1fr}}
.qc-vault-title h2{display:flex;align-items:center;gap:8px}.qc-learning-bell{position:relative;display:inline-grid;place-items:center;width:30px;height:30px;border:0;border-radius:8px;background:transparent;color:#758096;cursor:pointer}.qc-learning-bell.active{color:rgb(var(--v-theme-primary));background:rgba(var(--v-theme-primary),.1)}.qc-learning-bell:focus-visible{outline:2px solid #5977d5;outline-offset:2px}.qc-missing-active{color:rgb(var(--v-theme-error))}.qc-sync-report{margin-top:16px}.qc-sync-report .qc-vault-preview{grid-template-columns:repeat(4,minmax(0,1fr));margin-top:0}.qc-issue-list ul{margin:6px 0 2px 18px;font-size:12px}.qc-issue-list code{font-size:11px;overflow-wrap:anywhere}.qc-capacity{display:flex;align-items:center;gap:6px;margin-top:10px;font-size:12px;color:var(--qc-muted)}.qc-capacity.warn{color:rgb(var(--v-theme-warning));font-weight:600}@media(max-width:650px){.qc-sync-report .qc-vault-preview{grid-template-columns:1fr 1fr}}
.qc-learning-badge{position:absolute;top:-5px;right:-7px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:rgb(var(--v-theme-error));color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center}
</style>
