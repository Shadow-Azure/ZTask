<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

/**
 * 基础浮窗（03 §7.5）：teleport 到 body、focus trap、Escape 关闭、焦点归还。
 * overlay/modal 视觉沿用原型；焦点管理是组件职责，不复刻原型的显隐逻辑当可访问性。
 */
const props = defineProps<{
  open: boolean;
  title: string;
}>();

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
.overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(23, 28, 36, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 56px 16px 16px;
}

.modal {
  width: 720px;
  max-width: 100%;
  max-height: calc(100vh - 88px);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 12px 40px rgba(20, 28, 44, 0.22);
  overflow: hidden;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.modal-head h3 {
  font-size: 13.5px;
}

.icon-btn {
  margin-left: auto;
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  font-size: 13px;
  border-radius: 7px;
  padding: 3px 8px;
}

.icon-btn:hover {
  color: var(--text);
  background: var(--bg-inset);
}

.modal-body {
  padding: 14px 16px;
  overflow: auto;
}

.modal-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

.modal :deep(.modal-foot:empty) {
  display: none;
}
</style>
