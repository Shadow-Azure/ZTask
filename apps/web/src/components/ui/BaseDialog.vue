<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

/**
 * 基础浮窗（03 §7.5，原型 420–426/481–484）：teleport 到 body、focus trap、Escape 关闭、焦点归还。
 * 视觉对齐原型 .overlay/.modal：7vh 顶部起点、radius 14、白底 sticky 头/足；
 * width 属性按调用方选择浮窗宽度（任务 660 / 成员 440 / 确认 400）。
 * 焦点管理是组件职责，不复刻原型的显隐逻辑当可访问性。
 */
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    /** 浮窗宽度（px）；缺省 660（原型任务浮窗）。 */
    width?: number;
  }>(),
  { width: 660 },
);

const emit = defineEmits<{ close: [] }>();

const previouslyFocused = ref<HTMLElement | null>(null);
const dialogBody = ref<HTMLElement | null>(null);

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusFirstInDialog(): void {
  const dialog = dialogBody.value;
  if (!dialog) return;
  const target = dialog.querySelector<HTMLElement>(FOCUSABLE);
  (target ?? dialog).focus();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    event.stopPropagation();
    emit("close");
    return;
  }
  if (event.key !== "Tab" || !dialogBody.value) return;
  const focusables = [...dialogBody.value.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute("disabled"),
  );
  if (focusables.length === 0) return;
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialogBody.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      previouslyFocused.value = document.activeElement as HTMLElement | null;
      await nextTick();
      focusFirstInDialog();
    } else if (previouslyFocused.value) {
      previouslyFocused.value.focus();
      previouslyFocused.value = null;
    }
  },
);

onBeforeUnmount(() => {
  if (previouslyFocused.value) previouslyFocused.value.focus();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="overlay">
      <div
        ref="dialogBody"
        class="modal"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        :style="{ width: `${width}px` }"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <div class="modal-head">
          <h3>{{ title }}</h3>
          <slot name="head-extra" />
          <button class="icon-btn" type="button" title="关闭" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
        <div v-if="$slots.foot" class="modal-foot">
          <slot name="foot" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 原型 420–421。 */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(24, 28, 36, 0.42);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 7vh 20px 20px;
}

/* 原型 422：radius 14 + 大投影；宽度由 props 决定。 */
.modal {
  max-width: 100%;
  max-height: 84vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border-radius: 14px;
  box-shadow: 0 18px 50px rgba(20, 26, 38, 0.28);
  overflow: hidden;
}

/* 原型 423–425：白底头部、15/20/12 内距、h3 14.5px/700 占满剩余空间。 */
.modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 15px 20px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-card);
}

.modal-head h3 {
  font-size: 14.5px;
  font-weight: 700;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-btn {
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 13px;
  border-radius: 7px;
  padding: 3px 8px;
  flex: none;
}

.icon-btn:hover {
  color: var(--text);
  background: var(--bg-inset);
}

/* 原型 426：16/20 内距。 */
.modal-body {
  padding: 16px 20px;
  overflow: auto;
}

/* 原型 481：13/20 内距、上边框、白底、按钮间距 10（此前 8，R4-D7）。 */
.modal-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 13px 20px;
  border-top: 1px solid var(--border);
  background: var(--bg-card);
}

.modal :deep(.modal-foot:empty) {
  display: none;
}
</style>
