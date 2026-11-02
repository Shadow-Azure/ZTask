<script setup lang="ts">
import { computed } from "vue";

/**
 * 分栏拖柄（原型 tree-resizer / task-pane-resizer 的组件化）：
 * role=separator + aria 三值 + tabindex；左右方向键 ±2、Home/End 到边界（03 §8）。
 * 指针拖拽由父级布局监听 pointer 事件实现，本组件只负责键盘与语义。
 */
const props = defineProps<{
  /** 可读名称（aria-label）。 */
  label: string;
  min: number;
  max: number;
  modelValue: number;
}>();

const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const clamped = computed(() => Math.round(Math.min(props.max, Math.max(props.min, props.modelValue))));

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Home") {
    event.preventDefault();
    emit("update:modelValue", props.min);
    return;
  }
  if (event.key === "End") {
    event.preventDefault();
    emit("update:modelValue", props.max);
    return;
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  emit("update:modelValue", clamped.value + (event.key === "ArrowRight" ? 2 : -2));
}
</script>

<template>
  <div
    class="resizer"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="clamped"
    tabindex="0"
    title="拖拽调整宽度；也可使用左右方向键"
    @keydown="onKeydown"
  >
    <span />
  </div>
</template>

<style scoped>
.resizer {
  width: 6px;
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  flex: none;
}

.resizer span {
  width: 2px;
  height: 34px;
  border-radius: 999px;
  background: var(--border-strong);
}

.resizer:hover span,
.resizer:focus-visible span {
  background: var(--blue);
}

.resizer:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
</style>
