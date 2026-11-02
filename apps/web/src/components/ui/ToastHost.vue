<script setup lang="ts">
import { toastState } from "./toast";

/**
 * 全局轻提示宿主（aria-live=polite，03 §8）：挂在 App 根部一次即可。
 */
const state = toastState();
</script>

<template>
  <div class="toast" aria-live="polite">
    <div v-for="item in state.items" :key="item.id" class="toast-item">{{ item.text }}</div>
  </div>
</template>

<style scoped>
.toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  z-index: 400;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.toast-item {
  background: #16181d;
  color: #e8ebef;
  font-size: 12.5px;
  border-radius: 8px;
  padding: 8px 16px;
  box-shadow: 0 6px 24px rgba(20, 28, 44, 0.3);
  animation: toast-in 0.2s ease;
}

@keyframes toast-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
