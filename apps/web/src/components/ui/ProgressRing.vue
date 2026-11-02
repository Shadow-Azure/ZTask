<script setup lang="ts">
import { computed } from "vue";

/**
 * 环形进度（原型 subtask-progress-ring 的组件化，03 §7.3）。
 * role=progressbar + aria 全值 + 可读标签；完成态加 done 类（绿色）。
 */
const props = defineProps<{
  /** 0–100 整数，越界自动钳制。 */
  value: number;
  /** 可读名称（aria-label 组成部分，如小任务描述）。 */
  label: string;
}>();

const clamped = computed(() => Math.max(0, Math.min(100, Math.round(props.value))));
const radius = 14;
const circumference = computed(() => 2 * Math.PI * radius);
const offset = computed(() => circumference.value * (1 - clamped.value / 100));
</script>

<template>
  <span
    class="ring"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="clamped"
    :aria-label="`${label}，进度 ${clamped}%`"
  >
    <svg viewBox="0 0 38 38" aria-hidden="true">
      <circle class="ring-track" cx="19" cy="19" :r="radius" />
      <circle
        class="ring-value"
        :class="{ done: clamped === 100 }"
        cx="19"
        cy="19"
        :r="radius"
        :stroke-dasharray="circumference.toFixed(2)"
        :stroke-dashoffset="offset.toFixed(2)"
      />
      <text class="ring-text" x="19" y="19">{{ clamped }}%</text>
    </svg>
  </span>
</template>

<style scoped>
.ring {
  display: inline-flex;
  flex: none;
}

.ring,
.ring svg {
  width: 38px;
  height: 38px;
}

.ring-track,
.ring-value {
  fill: none;
  stroke-width: 3.5;
}

.ring-track {
  stroke: var(--bg-inset);
}

.ring-value {
  stroke: var(--blue);
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: center;
  transition: stroke-dashoffset 0.25s ease;
}

.ring-value.done {
  stroke: var(--green);
}

.ring-text {
  fill: var(--text);
  font-size: 9.5px;
  text-anchor: middle;
  dominant-baseline: central;
  font-family: var(--mono);
}
</style>
