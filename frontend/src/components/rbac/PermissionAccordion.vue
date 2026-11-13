<template>
  <div class="pa">
    <div class="pa-toolbar">
      <div class="pa-search">
        <span class="pa-search-icon">🔍</span>
        <input v-model="query" placeholder="Tìm quyền, ví dụ: khách hàng, lịch hẹn…" aria-label="Tìm quyền" />
        <button v-if="query" class="pa-search-clear" aria-label="Xóa tìm kiếm" @click="query = ''">×</button>
      </div>
      <div class="pa-toolbar-actions">
        <button class="pa-link" @click="expandAll">Mở tất cả</button>
        <span class="pa-sep">·</span>
        <button class="pa-link" @click="expanded = new Set()">Thu gọn</button>
      </div>
    </div>

    <p v-if="!visibleCategories.length" class="pa-empty">Không tìm thấy quyền phù hợp với “{{ query }}”.</p>

    <section v-for="cat in visibleCategories" :key="cat.id" class="pa-cat" :class="{ open: isOpen(cat.id), full: catCount(cat).on === catCount(cat).total, partial: catCount(cat).on > 0 && catCount(cat).on < catCount(cat).total }">
      <header class="pa-cat-head" role="button" tabindex="0" :aria-expanded="isOpen(cat.id)" @click="toggleOpen(cat.id)" @keydown.enter.prevent="toggleOpen(cat.id)" @keydown.space.prevent="toggleOpen(cat.id)">
        <span class="pa-cat-icon">{{ cat.icon }}</span>
        <div class="pa-cat-text">
          <div class="pa-cat-title">{{ cat.label }}</div>
          <div class="pa-cat-hint">{{ cat.hint }}</div>
        </div>
        <div class="pa-cat-progress" :title="`${catCount(cat).on}/${catCount(cat).total} quyền đang bật`">
          <div class="pa-bar"><div class="pa-bar-fill" :style="{ width: pct(catCount(cat)) + '%' }" /></div>
          <span class="pa-cat-count">{{ catCount(cat).on }}/{{ catCount(cat).total }}</span>
        </div>
        <label class="pa-switch" :title="catCount(cat).on === catCount(cat).total ? 'Tắt cả nhóm' : 'Bật cả nhóm'" @click.stop>
          <input type="checkbox" :checked="catCount(cat).on === catCount(cat).total" :disabled="disabled" :aria-label="`Bật toàn bộ ${cat.label}`" @change="setCategory(cat, ($event.target as HTMLInputElement).checked)" />
          <span class="pa-switch-track"><span class="pa-switch-thumb" /></span>
        </label>
        <span class="pa-chevron" aria-hidden="true">›</span>
      </header>

      <div v-show="isOpen(cat.id)" class="pa-cat-body">
        <div v-for="r in cat.resources" :key="r" class="pa-res" :class="{ on: !!grants?.[r]?.access, 'module-off': isModuleOff(r) }">
          <div class="pa-res-main">
            <span class="pa-res-icon">{{ resourceInfo(r).icon }}</span>
            <div class="pa-res-text">
              <div class="pa-res-title">
                {{ resourceInfo(r).label }}
                <span v-if="isModuleOff(r)" class="pa-tag-warn" :title="`Chỉ có hiệu lực khi bật ${resourceInfo(RESOURCE_MODULE[r]!).label}`">Cần bật Bot-Auto</span>
              </div>
              <div class="pa-res-hint">{{ resourceInfo(r).hint }}</div>
            </div>
            <label v-if="actionsOf(r).includes('access')" class="pa-switch pa-switch-sm" :title="grants?.[r]?.access ? 'Tắt truy cập (bỏ luôn các quyền con)' : 'Cho phép truy cập'">
              <input type="checkbox" :checked="!!grants?.[r]?.access" :disabled="disabled" :aria-label="`Truy cập ${resourceInfo(r).label}`" @change="setOne(r, 'access', ($event.target as HTMLInputElement).checked)" />
              <span class="pa-switch-track"><span class="pa-switch-thumb" /></span>
              <span class="pa-switch-text">{{ grants?.[r]?.access ? 'Được truy cập' : 'Không truy cập' }}</span>
            </label>
          </div>
          <div v-if="subActions(r).length" class="pa-actions">
            <label v-for="a in subActions(r)" :key="a" class="pa-chip" :class="{ checked: !!grants?.[r]?.[a], 'view-all': a === 'view_all' }" :title="ACTION_HINTS[a]">
              <input type="checkbox" :checked="!!grants?.[r]?.[a]" :disabled="disabled" @change="setOne(r, a, ($event.target as HTMLInputElement).checked)" />
              <span class="pa-chip-box">✓</span>{{ ACTION_LABELS[a] ?? a }}
            </label>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ACTION_HINTS, ACTION_LABELS, RESOURCE_MODULE, buildCategories, countGranted, resourceInfo, setAction, setResources, type Category, type Grants } from './permission-catalog';

const props = defineProps<{ resources: string[]; resourceActions: Record<string, string[]>; grants: Grants | undefined; disabled?: boolean }>();
const emit = defineEmits<{ change: [grants: Grants] }>();

const query = ref('');
const expanded = ref(new Set<string>(['overview']));

const categories = computed(() => buildCategories(props.resources));
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
const visibleCategories = computed(() => {
  const q = norm(query.value.trim());
  if (!q) return categories.value;
  return categories.value
    .map(c => {
      // Ưu tiên khớp từng quyền nhỏ; chỉ hiện cả nhóm khi gõ đúng tên nhóm lớn.
      const hits = c.resources.filter(r => norm(resourceInfo(r).label + ' ' + resourceInfo(r).hint + ' ' + r).includes(q));
      return hits.length ? { ...c, resources: hits } : norm(c.label).includes(q) ? c : { ...c, resources: [] };
    })
    .filter(c => c.resources.length);
});

const isOpen = (id: string) => !!query.value.trim() || expanded.value.has(id);
function toggleOpen(id: string) { const s = new Set(expanded.value); s.has(id) ? s.delete(id) : s.add(id); expanded.value = s; }
function expandAll() { expanded.value = new Set(categories.value.map(c => c.id)); }

const actionsOf = (r: string) => props.resourceActions[r] ?? [];
const subActions = (r: string) => actionsOf(r).filter(a => a !== 'access');
const catCount = (c: Category) => countGranted(props.grants, c.resources, props.resourceActions);
const pct = (c: { on: number; total: number }) => (c.total ? Math.round((c.on / c.total) * 100) : 0);
const isModuleOff = (r: string) => !!RESOURCE_MODULE[r] && props.grants?.[RESOURCE_MODULE[r]!]?.access !== true;

function setOne(r: string, a: string, v: boolean) { if (!props.disabled) emit('change', setAction(props.grants, r, a, v, actionsOf(r))); }
function setCategory(c: Category, v: boolean) { if (!props.disabled) emit('change', setResources(props.grants, c.resources, props.resourceActions, v)); }
</script>

<style scoped>
.pa { display: flex; flex-direction: column; gap: 10px; container-type: inline-size; }
.pa-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 4px; }
.pa-search { position: relative; flex: 1; min-width: 220px; max-width: 420px; }
.pa-search input { width: 100%; height: 38px; padding: 0 32px 0 34px; border: 1px solid #e0e2e6; border-radius: 10px; font-size: 13px; background: #fff; color: #181d26; outline: none; }
.pa-search input:focus { border-color: #1b61c9; box-shadow: 0 0 0 3px rgba(27,97,201,.12); }
.pa-search-icon { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); font-size: 13px; opacity: .6; }
.pa-search-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: 0; background: none; font-size: 18px; color: #9297a0; cursor: pointer; }
.pa-toolbar-actions { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.pa-link { border: 0; background: none; color: #1b61c9; font-weight: 600; cursor: pointer; padding: 4px; }
.pa-link:hover { text-decoration: underline; }
.pa-sep { color: #c4c7cd; }
.pa-empty { padding: 28px; text-align: center; color: #9297a0; font-size: 13px; }

.pa-cat { border: 1px solid #e0e2e6; border-radius: 12px; background: #fff; overflow: hidden; transition: box-shadow .15s, border-color .15s; }
.pa-cat.open { border-color: #c9d6ee; box-shadow: 0 4px 14px rgba(24,29,38,.06); }
.pa-cat-head { display: flex; align-items: center; gap: 14px; padding: 14px 16px; cursor: pointer; user-select: none; }
.pa-cat-head:hover { background: #f8fafc; }
.pa-cat-head:focus-visible { outline: 2px solid #1b61c9; outline-offset: -2px; }
.pa-cat-icon { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; font-size: 19px; background: #f1f4f9; flex-shrink: 0; }
.pa-cat.full .pa-cat-icon { background: #e7f4e9; }
.pa-cat.partial .pa-cat-icon { background: #fdf3df; }
.pa-cat-text { flex: 1; min-width: 0; }
.pa-cat-title { font-size: 14px; font-weight: 650; color: #181d26; }
.pa-cat-hint { font-size: 12px; color: #6b7280; margin-top: 2px; }
.pa-cat-progress { display: flex; align-items: center; gap: 8px; width: 150px; flex-shrink: 0; }
.pa-bar { flex: 1; height: 6px; border-radius: 99px; background: #eef0f3; overflow: hidden; }
.pa-bar-fill { height: 100%; border-radius: 99px; background: linear-gradient(90deg, #1b61c9, #3b82f6); transition: width .2s; }
.pa-cat.full .pa-bar-fill { background: #16a34a; }
.pa-cat-count { font-size: 12px; font-weight: 600; color: #4b5563; min-width: 38px; text-align: right; font-variant-numeric: tabular-nums; }
.pa-chevron { font-size: 22px; color: #9297a0; transition: transform .2s; width: 16px; text-align: center; }
.pa-cat.open .pa-chevron { transform: rotate(90deg); color: #1b61c9; }

.pa-cat-body { border-top: 1px solid #eef0f3; background: #fbfcfd; padding: 6px 12px 12px; }
.pa-res { padding: 12px 10px; border-bottom: 1px dashed #e7e9ec; }
.pa-res:last-child { border-bottom: 0; }
.pa-res-main { display: flex; align-items: center; gap: 12px; }
.pa-res-icon { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #fff; border: 1px solid #eceef1; font-size: 15px; flex-shrink: 0; }
.pa-res-text { flex: 1; min-width: 0; }
.pa-res-title { font-size: 13px; font-weight: 600; color: #181d26; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pa-res:not(.on) .pa-res-title { color: #6b7280; }
.pa-res-hint { font-size: 11.5px; color: #8a8f98; margin-top: 2px; }
.pa-tag-warn { font-size: 10.5px; font-weight: 600; color: #a15c00; background: #fff4e0; border: 1px solid #f5d9a6; padding: 1px 7px; border-radius: 99px; }
.pa-res.module-off .pa-res-icon, .pa-res.module-off .pa-actions { opacity: .55; }

.pa-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 0 42px; }
.pa-res:not(.on) .pa-actions .pa-chip:not(.checked) { opacity: .75; }
.pa-chip { position: relative; display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 12px 0 8px; border: 1px solid #dfe2e7; border-radius: 99px; background: #fff; font-size: 12px; color: #374151; cursor: pointer; transition: all .12s; }
.pa-chip:hover { border-color: #9aa8c2; }
.pa-chip input { position: absolute; opacity: 0; pointer-events: none; }
.pa-chip-box { width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid #c4c9d2; display: grid; place-items: center; font-size: 10px; color: transparent; transition: all .12s; }
.pa-chip.checked { border-color: #1b61c9; background: #eef4fd; color: #134a9a; font-weight: 600; }
.pa-chip.checked .pa-chip-box { background: #1b61c9; border-color: #1b61c9; color: #fff; }
.pa-chip.view-all.checked { border-color: #a15c00; background: #fff6e8; color: #7a4500; }
.pa-chip.view-all.checked .pa-chip-box { background: #c27400; border-color: #c27400; }
.pa-chip:has(input:focus-visible) { outline: 2px solid #1b61c9; outline-offset: 2px; }
.pa-chip:has(input:disabled) { cursor: not-allowed; opacity: .6; }

.pa-switch { position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; flex-shrink: 0; }
.pa-switch input { position: absolute; opacity: 0; pointer-events: none; }
.pa-switch-track { width: 38px; height: 22px; border-radius: 99px; background: #d5d9df; position: relative; transition: background .15s; }
.pa-switch-thumb { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.2); transition: transform .15s; }
.pa-switch input:checked + .pa-switch-track { background: #16a34a; }
.pa-switch input:checked + .pa-switch-track .pa-switch-thumb { transform: translateX(16px); }
.pa-switch input:focus-visible + .pa-switch-track { outline: 2px solid #1b61c9; outline-offset: 2px; }
.pa-switch input:disabled + .pa-switch-track { opacity: .5; cursor: not-allowed; }
.pa-switch-sm .pa-switch-track { width: 34px; height: 20px; }
.pa-switch-sm .pa-switch-thumb { width: 14px; height: 14px; }
.pa-switch-sm input:checked + .pa-switch-track .pa-switch-thumb { transform: translateX(14px); }
.pa-switch-text { font-size: 12px; color: #4b5563; min-width: 92px; }

@container (max-width: 620px) {
  .pa-cat-head { flex-wrap: wrap; gap: 10px; }
  .pa-cat-progress { order: 5; width: 100%; padding-left: 54px; }
  .pa-res-main { flex-wrap: wrap; }
  .pa-switch-sm { margin-left: 42px; }
  .pa-actions { margin-left: 0; }
}
</style>
