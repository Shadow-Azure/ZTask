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
/* 原型 487–489：距视口底 34px。 */
.toast {
  position: fixed;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  z-index: 400;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

/* 原型 489：深底白字、r9、9px 18px 内距、0 8px 24px 阴影（R6-D1 逐值对齐）。 */
.toast-item {
  background: #212832;
  color: #fff;
  font-size: 12.5px;
  border-radius: 9px;
  padding: 9px 18px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
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
