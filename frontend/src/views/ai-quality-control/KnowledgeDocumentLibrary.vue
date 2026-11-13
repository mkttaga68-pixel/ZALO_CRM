<template>
  <div class="library">
    <div class="library-heading">
      <div><h2>Bộ quy tắc theo nhóm kiểm tra</h2><p>{{ activeRules.length }} quy tắc đang áp dụng · Chọn nhóm để xem tài liệu và quản lý quy tắc của nhóm đó.</p></div>
      <span class="library-total">{{ latest.length }} tài liệu · {{ documents.length }} phiên bản</span>
    </div>
    <div class="rule-groups" aria-label="Nhóm nội dung cần kiểm tra">
      <button v-for="item in groupCards" :key="item.key" type="button" :class="['rule-group-card',{active:analysisGroup===item.key,reference:item.key==='REFERENCE'||item.key==='UNASSIGNED'}]" :aria-pressed="analysisGroup===item.key" @click="analysisGroup=analysisGroup===item.key?'':item.key">
        <span class="rule-group-name"><v-icon size="19">{{ item.icon }}</v-icon>{{ item.label }}</span>
        <strong>{{ item.current }} tài liệu</strong><span>{{ item.active }} đang áp dụng · {{ item.versions }} phiên bản</span>
      </button>
    </div>
    <div class="library-view-options"><p>Nhóm kiểm tra dùng chung với cấu hình phòng ban. Nhóm dự kiến của bản nháp cần được xác nhận khi duyệt.</p><v-switch v-model="history" label="Xem cả phiên bản cũ" density="compact" hide-details inset color="primary" /></div>
    <div class="library-stats" aria-label="Lọc nhanh theo trạng thái">
      <button v-for="item in statuses" :key="item.value" type="button" :class="['stat', { active: status === item.value }]" :aria-pressed="status === item.value" @click="status = item.value">
        <span>{{ item.title }}</span><strong>{{ item.value ? visibleDocuments.filter(d => d.status === item.value).length : visibleDocuments.length }}</strong>
      </button>
    </div>
    <div class="library-filters">
      <v-text-field v-model="search" label="Tìm tài liệu" placeholder="Tên, mã quy tắc hoặc nội dung…" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details clearable />
      <v-select v-model="category" :items="categories" label="Thư mục Obsidian" variant="outlined" density="compact" hide-details clearable />
      <v-select v-model="sort" :items="sortOptions" label="Sắp xếp" variant="outlined" density="compact" hide-details />
    </div>
    <div class="library-result" aria-live="polite"><span>{{ analysisGroup ? groupName(analysisGroup)+' · ' : '' }}Hiển thị {{ filtered.length }} / {{ visibleDocuments.length }} {{ history ? 'phiên bản' : 'tài liệu mới nhất' }}</span><v-btn v-if="search || category || status || analysisGroup" size="small" variant="text" @click="search = ''; category = null; status = ''; analysisGroup=''">Xóa bộ lọc</v-btn></div>
    <v-table class="library-table" density="compact">
      <thead><tr><th>Quy tắc / Tài liệu</th><th>Nhóm kiểm tra</th><th>Trạng thái</th><th>Phiên bản</th><th><span class="sr-only">Thao tác</span></th></tr></thead>
      <tbody>
        <template v-for="section in pagedSections" :key="section.key">
        <tr class="rule-group-heading"><th colspan="5"><v-icon size="17" class="mr-2">{{ section.icon }}</v-icon>{{ section.label }}<span>{{ section.total }} {{ history ? 'phiên bản' : 'tài liệu' }} phù hợp</span></th></tr>
        <tr v-for="d in section.documents" :key="d.id">
          <td><div class="document-cell"><span class="document-icon"><v-icon size="18">mdi-file-document-outline</v-icon></span><div><button type="button" class="document-link" @click="open(d)">{{ title(d) }}</button><div class="document-path"><strong v-if="documentRuleId(d)">{{ documentRuleId(d) }} · </strong><v-icon size="12">mdi-folder-outline</v-icon> {{ groupLabel(d) }}</div><div v-if="d.rule?.slaSeconds || d.rule?.careIntervalDays" class="document-path"><span v-if="d.rule.slaSeconds">SLA {{ d.rule.slaSeconds / 60 }} phút làm việc</span><span v-if="d.rule.careIntervalDays"> · Chăm sóc {{ d.rule.careIntervalDays }} ngày/lần</span></div><span v-if="d.knowledgeClass === 'VERIFIED_LEARNING_CASE'" class="class-tag case">Tình huống tham chiếu</span></div></div></td>
          <td><span class="rule-membership">{{ groupName(documentGroup(d).key) }}</span><div v-if="documentGroup(d).suggested" class="document-path">Nhóm dự kiến · chưa thiết lập</div></td>
          <td><v-chip :color="qcTone(d.status)" size="small" variant="tonal">{{ qcLabel(d.status) }}</v-chip><div v-if="activeIds.has(d.id)" class="document-path active-rule">Đang áp dụng</div><div v-else-if="activeByDocument.get(d.documentId)" class="document-path">Đang áp dụng r{{ activeByDocument.get(d.documentId)?.revision }}</div><div v-else-if="d.status==='APPROVED' && d.effectiveFrom && Date.parse(d.effectiveFrom)>Date.now()" class="document-path">Chưa đến ngày hiệu lực</div><div v-else-if="d.status==='APPROVED'" class="document-path">Không còn hiệu lực</div></td>
          <td><span class="revision">r{{ d.revision }}</span></td>
          <td class="document-action"><v-btn size="small" variant="tonal" color="primary" append-icon="mdi-arrow-right" @click="open(d)">{{ d.status === 'DRAFT' && canApprove ? 'Xem và thiết lập' : 'Xem chi tiết' }}</v-btn></td>
        </tr>
        </template>
        <tr v-if="!filtered.length"><td colspan="5"><div class="library-empty"><v-icon size="36" color="grey">mdi-file-search-outline</v-icon><h3>{{ documents.length ? 'Không tìm thấy tài liệu phù hợp' : 'Chưa có tài liệu' }}</h3><p>{{ documents.length ? 'Thử đổi nhóm, từ khóa hoặc xóa bộ lọc.' : 'Đồng bộ từ thư mục Obsidian để bắt đầu quản lý.' }}</p></div></td></tr>
      </tbody>
    </v-table>
    <v-pagination v-if="filtered.length > pageSize" v-model="page" :length="Math.ceil(filtered.length / pageSize)" :total-visible="5" density="compact" class="pa-3" aria-label="Trang tài liệu" />
    <v-dialog v-model="dialog" max-width="1240" scrollable>
      <v-card v-if="selected" class="document-dialog">
        <v-card-title class="dialog-heading"><div><div class="dialog-eyebrow">QUẢN LÝ QUY TẮC <span>· Phiên bản {{ selected.revision }}</span></div><h2>{{ title(selected) }}</h2><p>{{ selected.sourcePath }}</p></div><v-btn icon="mdi-close" size="small" variant="text" aria-label="Đóng chi tiết tài liệu" @click="dialog = false" /></v-card-title>
        <div class="dialog-meta"><v-chip :color="qcTone(selected.status)" size="small" variant="tonal">{{ qcLabel(selected.status) }}</v-chip><v-chip size="small" variant="tonal">{{ groupName(documentGroup(selected).key) }}</v-chip><span v-if="documentGroup(selected).suggested">Nhóm dự kiến; xác nhận loại phân tích khi duyệt.</span><span><v-icon size="14" class="mr-1">mdi-file-edit-outline</v-icon>Sửa nội dung tại Obsidian → Đồng bộ bản nháp → Duyệt</span></div>
        <v-card-text class="dialog-content">
          <slot name="detail" />
        </v-card-text>
        <v-card-actions class="dialog-bottom"><span>Kiểm tra nội dung và phạm vi trước khi áp dụng cho AI.</span><v-spacer /><v-btn variant="outlined" size="small" @click="dialog = false">Đóng</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { QcDocument } from '@/api/ai-quality-control';
import { qcLabel, qcTone } from './presentation';
import {knowledgeGroups,documentGroup,documentRuleId,latestDocuments,activeDocuments} from './knowledge-groups';

const props = defineProps<{ documents: QcDocument[]; selected: QcDocument | null; canApprove: boolean }>();
const emit = defineEmits<{ select: [document: QcDocument] }>();
const search = ref<string | null>(''), category = ref<string | null>(null), status = ref(''), sort = ref('name'), page = ref(1), dialog = ref(false);
const analysisGroup=ref(''),history=ref(false);
const latest=computed(()=>latestDocuments(props.documents));
const visibleDocuments=computed(()=>history.value?props.documents:latest.value);
const activeRules=computed(()=>activeDocuments(props.documents));
const activeIds=computed(()=>new Set(activeRules.value.map(d=>d.id)));
const activeByDocument=computed(()=>new Map(activeRules.value.map(d=>[d.documentId,d])));
const groupName=(key:string)=>knowledgeGroups.find(group=>group.key===key)?.label??'Chưa phân nhóm';
const groupCards=computed(()=>knowledgeGroups.map(group=>({...group,current:latest.value.filter(d=>documentGroup(d).key===group.key).length,versions:props.documents.filter(d=>documentGroup(d).key===group.key).length,active:activeRules.value.filter(d=>documentGroup(d).key===group.key).length})));
const pageSize = 12;
const statuses = [{ title: 'Tất cả', value: '' }, { title: 'Bản nháp', value: 'DRAFT' }, { title: 'Đã duyệt', value: 'APPROVED' }, { title: 'Đã thu hồi', value: 'REVOKED' }];
const sortOptions = [{ title: 'Tên tài liệu A → Z', value: 'name' }, { title: 'Phiên bản mới nhất', value: 'revision' }];
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi-VN');
const title = (d: QcDocument) => d.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || d.sourcePath.split(/[\\/]/).pop()?.replace(/\.md$/i, '').replace(/_/g, ' ') || d.sourcePath;
const group = (d: QcDocument) => d.sourcePath.split(/[\\/]/).slice(0, -1).join('/') || 'Chưa phân nhóm';
const prettyGroup = (value: string) => { const text = (value.split('/').pop() || value).replace(/^\d+_/, '').replace(/_/g, ' ').toLocaleLowerCase('vi-VN'); return text.charAt(0).toLocaleUpperCase('vi-VN') + text.slice(1); };
const groupLabel = (d: QcDocument) => prettyGroup(group(d));
const categories = computed(() => [...new Set(props.documents.map(group))].sort((a, b) => a.localeCompare(b, 'vi')).map(value => ({ value, title: prettyGroup(value) })));
const filtered = computed(() => {
  const query = normalize(search.value?.trim() || '');
  return visibleDocuments.value.filter(d => (!analysisGroup.value || documentGroup(d).key===analysisGroup.value) && (!status.value || d.status === status.value) && (!category.value || group(d) === category.value) && (!query || normalize(`${title(d)} ${d.sourcePath} ${d.markdown}`).includes(query)))
    .sort((a,b)=>knowledgeGroups.findIndex(g=>g.key===documentGroup(a).key)-knowledgeGroups.findIndex(g=>g.key===documentGroup(b).key)||(sort.value === 'revision' ? b.revision - a.revision || title(a).localeCompare(title(b), 'vi') : title(a).localeCompare(title(b), 'vi')));
});
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const pagedSections=computed(()=>knowledgeGroups.map(group=>({...group,documents:paged.value.filter(d=>documentGroup(d).key===group.key),total:filtered.value.filter(d=>documentGroup(d).key===group.key).length})).filter(group=>group.documents.length));
function open(d: QcDocument) { emit('select', d); dialog.value = true; }
watch([search, category, status, sort, analysisGroup, history], () => { page.value = 1; });
watch(() => props.documents, () => { page.value = Math.min(page.value, Math.max(1, Math.ceil(filtered.value.length / pageSize))); });
watch(() => props.selected, selected => { if (!selected) dialog.value = false; });
</script>

<style scoped>
.rule-groups{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:0 24px 16px}.rule-group-card{display:flex;flex-direction:column;gap:8px;text-align:left;padding:16px;border:1px solid rgba(127,145,175,.2);border-radius:12px;background:transparent;color:inherit;cursor:pointer;font:inherit;min-width:0}.rule-group-card.active{border-color:rgb(var(--v-theme-primary));background:rgba(var(--v-theme-primary),.06)}.rule-group-card:hover{background:rgba(var(--v-theme-primary),.04)}.rule-group-card:focus-visible{outline:2px solid rgb(var(--v-theme-primary));outline-offset:3px}.rule-group-card.reference{grid-column:span 2;background:rgba(127,145,175,.035)}.rule-group-name{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:650}.rule-group-name .v-icon{color:rgb(var(--v-theme-primary));flex-shrink:0}.rule-group-card strong{font-size:17px}.rule-group-card>span:last-child{font-size:11px;color:#758096}.library-view-options{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:0 24px 18px}.library-view-options p{font-size:12px;color:#758096;line-height:1.6}.library-view-options .v-switch{flex:0 0 auto}.library-view-options :deep(.v-label){font-size:12px}.rule-group-heading th{padding:12px 18px!important;font-weight:650!important;color:rgb(var(--v-theme-primary))!important;background:rgba(var(--v-theme-primary),.05)!important;text-align:left}.rule-group-heading th span{margin-left:12px;color:#758096;font-size:11px;font-weight:400}.rule-membership{display:inline-block;max-width:210px;font-size:12px;font-weight:600}.document-path.active-rule{color:#2f8a6f;font-weight:600}@media(max-width:1000px){.rule-groups{grid-template-columns:repeat(2,minmax(0,1fr))}.rule-group-card.reference{grid-column:auto}}@media(max-width:700px){.rule-groups{padding:0 18px 16px}.library-view-options{align-items:flex-start;flex-direction:column;padding:0 18px 16px;gap:4px}}@media(max-width:420px){.rule-groups{grid-template-columns:1fr}}
.library{border:1px solid rgba(127,145,175,.2);border-radius:14px;background:rgb(var(--v-theme-surface));overflow:hidden}.library-heading{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:24px 24px 18px}.library h2{font-size:19px;font-weight:650}.library-heading p,.library-result,.library-total{font-size:13px;color:rgb(var(--v-theme-on-surface-variant))}.library-heading p{margin-top:5px}.library-total{white-space:nowrap;background:rgba(127,145,175,.09);border-radius:8px;padding:7px 12px}.library-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:0 24px 20px}.stat{display:flex;align-items:center;justify-content:space-between;text-align:left;padding:14px 16px;gap:10px;border:1px solid rgba(127,145,175,.2);border-radius:10px;font-size:13px;transition:background .15s}.stat strong{font-size:22px}.stat.active{color:rgb(var(--v-theme-primary));border-color:currentColor;background:rgba(var(--v-theme-primary),.06)}.stat:hover{background:rgba(var(--v-theme-primary),.06)}.stat:focus-visible,.document-link:focus-visible{outline:2px solid rgb(var(--v-theme-primary));outline-offset:3px}.library-filters{display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px;padding:0 24px}.library-result{padding:12px 24px;min-height:52px;display:flex;align-items:center;justify-content:space-between}.library-table th{background:rgba(127,145,175,.05);font-size:12px!important;white-space:nowrap}.library-table td{padding:14px 18px!important;vertical-align:middle!important}.library-table tbody tr:hover{background:rgba(var(--v-theme-primary),.03)}.document-link{display:block;text-align:left;font-size:13px;font-weight:600;color:rgb(var(--v-theme-on-surface));overflow-wrap:anywhere}.document-link:hover{color:rgb(var(--v-theme-primary))}.document-path{font-size:11px;color:rgb(var(--v-theme-on-surface-variant));margin-top:5px;overflow-wrap:anywhere}.document-action{white-space:nowrap;text-align:right}.revision{font-size:12px;background:rgba(127,145,175,.09);padding:4px 8px;border-radius:5px}.library-empty{padding:38px 12px;text-align:center}.library-empty h3{font-size:15px;margin:12px 0 6px}.library-empty p{font-size:13px;color:rgb(var(--v-theme-on-surface-variant))}.dialog-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:22px 24px 12px!important;white-space:normal!important}.dialog-heading h2{font-size:20px;overflow-wrap:anywhere}.dialog-heading p{font-size:12px;overflow-wrap:anywhere;color:rgb(var(--v-theme-on-surface-variant));margin-top:6px}.dialog-meta{display:flex;align-items:center;gap:12px;font-size:12px}.document-dialog{border-radius:16px!important}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}
.library-heading p,.library-result,.library-total,.document-path,.library-empty p,.dialog-heading p{color:#758096}.stat{background:transparent;color:inherit;cursor:pointer;font-family:inherit}.document-link{background:transparent;border:0;padding:0;font-family:inherit;cursor:pointer}.document-dialog :deep(.v-btn){text-transform:none;letter-spacing:0}
.document-cell{display:flex;gap:12px;align-items:flex-start}.document-icon{width:34px;height:34px;flex-shrink:0;display:grid;place-items:center;border-radius:9px;background:rgba(var(--v-theme-primary),.08);color:rgb(var(--v-theme-primary))}.document-path{display:flex;align-items:center;gap:4px}
.document-dialog{max-height:90dvh!important}.dialog-heading{padding:20px 24px 12px!important}.dialog-heading h2{font-size:19px;line-height:1.45;margin-top:5px;font-weight:650}.dialog-heading p{font-size:11px;margin-top:5px}.dialog-eyebrow{font-size:10px;font-weight:650;letter-spacing:1px;color:#758096}.dialog-eyebrow span{font-weight:400;letter-spacing:0;margin-left:6px}.dialog-meta{padding:0 24px 16px;gap:12px;border-bottom:1px solid rgba(127,145,175,.18);flex-wrap:wrap}.dialog-meta>span{font-size:11px;color:#758096;display:flex;align-items:center}.dialog-content{padding:0!important;overflow-y:auto!important;min-height:0}.dialog-bottom{padding:12px 24px!important;border-top:1px solid rgba(127,145,175,.18);gap:12px}.dialog-bottom>span{font-size:11px;color:#758096}.dialog-content :deep(.doc-layout){display:grid;grid-template-columns:minmax(0,1fr) 400px;align-items:start}.dialog-content :deep(.doc-reading){padding:22px 26px;min-width:0}.dialog-content :deep(.doc-config){padding:22px;background:rgba(127,145,175,.035);border-left:1px solid rgba(127,145,175,.18);min-width:0;min-height:100%}.dialog-content :deep(.doc-section-heading){display:flex;gap:8px;align-items:center;margin-bottom:16px;color:#758096}.dialog-content :deep(.doc-section-heading h3){font-size:13px;font-weight:650;color:rgb(var(--v-theme-on-surface));margin:0}.dialog-content :deep(.doc-config-note){font-size:12px;line-height:1.7;color:#758096;margin:-5px 0 18px}.dialog-content :deep(.doc-config .v-field__input){font-size:12px}.dialog-content :deep(.doc-config .v-label){font-size:12px}.dialog-content :deep(.doc-config .v-input__details){min-height:12px;padding-top:0}.dialog-content :deep(.doc-config .v-checkbox .v-label){line-height:1.6;white-space:normal}.dialog-content :deep(.doc-config .v-btn){width:100%;font-size:12px}.dialog-content :deep(.doc-config>p:not(.doc-config-note)){font-size:12px;line-height:1.7;margin-bottom:16px;overflow-wrap:anywhere}.dialog-content :deep(.doc-source){margin-top:22px;padding-top:14px;border-top:1px solid rgba(127,145,175,.18);font-size:11px;color:#758096}.dialog-content :deep(.doc-source summary){cursor:pointer}.dialog-content :deep(.doc-raw){font-size:11px;line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:rgba(127,145,175,.06);border-radius:6px;margin-top:12px}
@media(max-width:850px){.dialog-content :deep(.doc-layout){grid-template-columns:1fr}.dialog-content :deep(.doc-config){border-left:0;border-top:1px solid rgba(127,145,175,.18)}.dialog-heading{padding:16px 18px 10px!important}.dialog-meta{padding:0 18px 12px}.dialog-content :deep(.doc-reading),.dialog-content :deep(.doc-config){padding:18px}.dialog-bottom>span{display:none}}
@media(max-width:700px){.library-heading{padding:18px}.library-total{display:none}.library-stats{grid-template-columns:repeat(2,1fr);padding:0 18px 18px;gap:8px}.library-filters{grid-template-columns:1fr;padding:0 18px}.library-result{padding:10px 18px}.stat{padding:10px 12px}.library-table td{padding:12px!important}.dialog-heading h2{font-size:17px}}
.class-tag{display:inline-block;margin-top:4px;font-size:11px;font-weight:600;padding:0 8px;border-radius:999px}.class-tag.case{background:rgba(89,119,213,.1);color:#4a64b8}
</style>
