<script setup lang="ts">
import type { Importance } from "@ztask/shared";

/**
 * 重要度标记：色点 + 文字（03 §7.4——所有颜色同时有文本，不靠颜色单独传达）。
 * 高红、中橙、低灰；dotOnly 模式供树/成员视图等紧凑场景。
 */
defineProps<{
  importance: Importance;
  /** 只渲染色点，不带文字。 */
  dotOnly?: boolean;
}>();

const NAMES: Record<Importance, string> = { high: "高", mid: "中", low: "低" };
</script>

<template>
  <span class="imp-mark">
    <span class="imp-dot" :class="importance" />
    <span v-if="!dotOnly" class="imp" :class="importance">{{ NAMES[importance] }}重要</span>
  </span>
</template>

<style scoped>
.imp-mark {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.imp-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: none;
}

.imp-dot.high {
  background: var(--red);
}

.imp-dot.mid {
  background: var(--orange);
}

.imp-dot.low {
  background: var(--text-faint);
}

.imp {
  font-size: 11px;
}

.imp.high {
  color: var(--red);
}

.imp.mid {
  color: var(--orange);
}

.imp.low {
  color: var(--text-faint);
}
</style>
