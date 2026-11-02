<script setup lang="ts">
/**
 * 加载态视图。
 */
defineProps<{ label?: string }>();
</script>

<template>
  <div class="loading-state" role="status" :aria-label="label ?? '加载中'">
    <span class="spinner" aria-hidden="true" />
    <span>{{ label ?? "加载中…" }}</span>
  </div>
</template>

<style scoped>
.loading-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-faint);
  font-size: 12px;
  padding: 18px 0;
  justify-content: center;
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--blue);
  border-radius: 999px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
