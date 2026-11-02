<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

/**
 * 分栏拖柄（原型 tree-resizer / task-pane-resizer 的组件化）：
 * role=separator + aria 三值 + tabindex；左右方向键按 step 步进（默认 ±2），Home/End 到边界（03 §8）。
 * 指针拖拽由父级布局监听 pointer 事件实现，本组件只负责键盘与语义。
 */
const props = defineProps<{
  /** 可读名称（aria-label）。 */
  label: string;
  min: number;
  max: number;
  modelValue: number;
  /** 方向键单次步进（px 或百分比）；树分栏传 16，与原型 tree-resizer 的 ±16 一致。 */
  step?: number;
  /**
   * 形态变体（原型 128 行树 gutter 10px / 224 行卡内 gutter 13px）：
   * tree 用通高 2px --border 分隔线，pane 用通高 1px --border-soft 中缝线。
   */
  variant?: "tree" | "pane";
}>();

const emit = defineEmits<{
  "update:modelValue": [value: number];
  /** 指针拖拽过程中的原始 clientX；由父级映射为面板宽度。 */
  drag: [clientX: number];
  dragend: [];
}>();

const clamped = computed(() => Math.round(Math.min(props.max, Math.max(props.min, props.modelValue))));

const dragging = ref(false);

function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return;
  event.preventDefault();
  dragging.value = true;
  try {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  } catch {
    // 无活动指针（如测试环境）时忽略；拖拽状态已进入。
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging.value) return;
  emit("drag", event.clientX);
}

function onPointerUp(): void {
  if (!dragging.value) return;
  dragging.value = false;
  emit("dragend");
}

onBeforeUnmount(() => {
  dragging.value = false;
});

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
  const step = props.step ?? 2;
  const next = clamped.value + (event.key === "ArrowRight" ? step : -step);
  emit("update:modelValue", Math.min(props.max, Math.max(props.min, next)));
}
</script>

<template>
  <div
    class="resizer"
    :class="[variant === 'pane' ? 'is-pane' : 'is-tree', { dragging }]"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuenow="clamped"
    tabindex="0"
    title="拖拽调整宽度；也可使用左右方向键"
    @keydown="onKeydown"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <span />
  </div>
</template>

<style scoped>
/* 原型 138–142（tree）/ 225–229（pane）：槽内是一条通高分隔线 + 悬停才出现的短柄。
 * 槽宽此前统一 6px，比原型窄 4~7px，正是全局面板宽度差 4px 的根因（R4-D5）。 */
.resizer {
  position: relative;
  width: var(--resizer-tree);
  cursor: col-resize;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  touch-action: none;
}

/* 原型 138：树槽自身为 --bg-card 白底，分隔线两侧各 4px 才是白槽（R7-D1）；
 * 基础 .resizer 的 transparent 保留给卡内分栏（is-pane），不在此覆盖。 */
.resizer.is-tree {
  background: var(--bg-card);
}

/* 原型 139：树分隔线 = 通高 2px --border（10px 槽内两侧各让 4px）。 */
.resizer.is-tree::before {
  content: "";
  position: absolute;
  inset: 0 4px;
  background: var(--border);
  transition: background 0.15s, inset 0.15s;
}

.resizer.is-tree:hover::before,
.resizer.is-tree:focus-visible::before,
.resizer.is-tree.dragging::before {
  inset: 0 3px;
  background: color-mix(in srgb, var(--blue) 45%, transparent);
}

/* 原型 226：卡内中缝线 = 通高 1px --border-soft，位置 6px。 */
.resizer.is-pane {
  width: var(--resizer-pane);
}

.resizer.is-pane::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 6px;
  width: 1px;
  background: var(--border-soft);
  transition: background 0.15s, width 0.15s, left 0.15s;
}

.resizer.is-pane:hover::before,
.resizer.is-pane:focus-visible::before,
.resizer.is-pane.dragging::before {
  left: 5px;
  width: 3px;
  background: color-mix(in srgb, var(--blue) 45%, transparent);
}

/* 短柄默认不可见（原型 140/227 opacity: 0），悬停/聚焦/拖拽时显蓝。 */
.resizer span {
  width: 3px;
  height: 30px;
  border-radius: 3px;
  background: var(--border-strong);
  opacity: 0;
  transition: opacity 0.15s, background 0.15s;
}

.resizer.is-pane span {
  position: absolute;
  top: 50%;
  left: 4px;
  width: 5px;
  height: 28px;
  border-radius: 4px;
  transform: translateY(-50%);
}

.resizer:hover span,
.resizer:focus-visible span,
.resizer.dragging span {
  opacity: 1;
  background: var(--blue);
}

.resizer:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
</style>
