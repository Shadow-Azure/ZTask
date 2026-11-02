<script setup lang="ts">
/**
 * 空态视图：统一占位样式，避免各页面重绘（03 §7 状态一致性）。
 */
defineProps<{
  /** 一句话说明（何时会有内容）。 */
  hint?: string;
  /** 主文案；缺省"暂无内容"。 */
  title?: string;
}>();
</script>

<template>
  <div class="empty-state">
    <p class="title">{{ title ?? "暂无内容" }}</p>
    <p v-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.empty-state {
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-panel);
  padding: 26px 16px;
  text-align: center;
}

.title {
  font-size: 12.5px;
  color: var(--text-dim);
}

.hint {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 4px;
}
</style>
