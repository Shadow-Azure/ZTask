<script setup lang="ts">
/**
 * 错误态视图：不透出后端错误正文与 requestId 之外的技术细节（03 §8）。
 */
defineProps<{
  /** 用户可读的一句话错误说明。 */
  message: string;
  /** 是否展示重试按钮。 */
  retryable?: boolean;
}>();

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="error-state" role="alert">
    <p class="message">{{ message }}</p>
    <button v-if="retryable" class="retry" type="button" @click="emit('retry')">重试</button>
  </div>
</template>

<style scoped>
.error-state {
  border: 1px solid color-mix(in srgb, var(--red) 35%, var(--border));
  background: color-mix(in srgb, var(--red) 5%, var(--bg-card));
  border-radius: var(--radius);
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.message {
  font-size: 12.5px;
  color: var(--red);
}

.retry {
  margin-left: auto;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border-strong);
  background: var(--bg-card);
  color: var(--text);
  border-radius: 7px;
  padding: 4px 12px;
  cursor: pointer;
}
</style>
