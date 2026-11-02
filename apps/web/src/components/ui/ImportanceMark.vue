<script setup lang="ts">
import type { Importance } from "@ztask/shared";

/**
 * 重要度标记：色点 + 文字（03 §7.4——所有颜色同时有文本，不靠颜色单独传达）。
 * 高红、中橙、低灰；dotOnly 模式供树/成员视图等紧凑场景；
 * chip 模式为 tinted 同色底 chip、无色点（原型 .imp 81–84 行，管理端任务卡 facts 用，R2-D1）。
 */
defineProps<{
  importance: Importance;
  /** 只渲染色点，不带文字。 */
  dotOnly?: boolean;
  /** 只渲染 tinted chip（无色点），对齐原型 facts「高重要」chip 形态。 */
  chip?: boolean;
}>();

const NAMES: Record<Importance, string> = { high: "高", mid: "中", low: "低" };
</script>

<template>
  <span v-if="chip" class="imp-chip" :class="importance">{{ NAMES[importance] }}重要</span>
  <span v-else class="imp-mark">
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

/* 原型 81–84：tinted chip——11px/600、padding 1px 8px、radius 6、同色 11–13% 底、无色点。 */
.imp-chip {
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  padding: 1px 8px;
  white-space: nowrap;
}

.imp-chip.high {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 11%, transparent);
}

.imp-chip.mid {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 13%, transparent);
}

.imp-chip.low {
  color: var(--text-dim);
  background: color-mix(in srgb, var(--text-dim) 12%, transparent);
}
</style>
