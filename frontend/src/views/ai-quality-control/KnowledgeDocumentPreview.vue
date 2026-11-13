<template>
  <article class="preview">
    <template v-for="(line, index) in lines" :key="index">
      <component :is="line.tag" :class="{ bullet: line.bullet }"><template v-for="(part, i) in line.parts" :key="i"><component :is="part.tag">{{ part.text }}</component></template></component>
    </template>
    <p v-if="!lines.length">Tài liệu chưa có nội dung.</p>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ markdown: string }>();
// Only text nodes and fixed formatting tags: source HTML never runs in the page.
const lines = computed(() => props.markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---(?:\n|$)/, '').split('\n').filter(line => line.trim()).map(line => {
  const heading = line.match(/^(#{1,6})\s+(.+)$/), bullet = /^\s*[-*+]\s+/.test(line), quote = /^>\s?/.test(line);
  const text = heading ? heading[2]! : line.replace(/^\s*[-*+]\s+|^>\s?/, '');
  return { tag: heading ? `h${Math.min(heading[1]!.length + 1, 6)}` : quote ? 'blockquote' : 'p', bullet,
    parts: text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map(part => part.startsWith('**') ? {tag:'strong',text:part.slice(2,-2)} : part.startsWith('`') ? {tag:'code',text:part.slice(1,-1)} : {tag:'span',text:part}) };
}));
</script>

<style scoped>
.preview{font-size:13px;line-height:1.8;overflow-wrap:anywhere;color:rgb(var(--v-theme-on-surface))}.preview h2{font-size:18px;line-height:1.5;margin-bottom:16px;font-weight:650}.preview h3{font-size:14px;font-weight:650;margin:22px 0 8px}.preview h4,.preview h5,.preview h6{font-size:13px;font-weight:650;margin:16px 0 8px}.preview p{margin:7px 0}.preview .bullet{position:relative;padding-left:15px}.preview .bullet:before{content:'•';position:absolute;left:1px;color:#758096}.preview blockquote{margin:14px 0;padding:10px 12px;border-left:3px solid #90a9e9;background:rgba(var(--v-theme-primary),.045);border-radius:0 6px 6px 0;font-size:12px}.preview code{font-size:11px;background:rgba(127,145,175,.09);padding:2px 4px;border-radius:4px}
</style>
