<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import type { AdminMember } from "@ztask/shared";

/**
 * 任务管理工具栏的负责人多选筛选（原型 .fsel，2026-11-03 新增）：
 * 紧凑触发框展示首个已选成员 +N，面板内支持姓名/角色搜索、多选、清除。
 * 纯受控组件：选中 ID 由 v-model 传入，筛选请求由父级发往服务端。
 */
const props = defineProps<{
  /** 活跃成员目录。 */
  members: AdminMember[];
  /** 已选成员 id 集合。 */
  modelValue: string[];
  /** 无障碍标签。 */
  ariaLabel: string;
}>();

const emit = defineEmits<{ "update:modelValue": [ids: string[]] }>();

const open = ref(false);
const keyword = ref("");
const alignRight = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

const selectedMembers = computed(() =>
  props.modelValue
    .map((id) => props.members.find((member) => member.id === id))
    .filter((member): member is AdminMember => member !== undefined),
);
const firstSelected = computed(() => selectedMembers.value[0]);
const overflowCount = computed(() => Math.max(0, selectedMembers.value.length - 1));
const hasSelection = computed(() => props.modelValue.length > 0);

const filteredMembers = computed(() => {
  const kw = keyword.value.trim();
  if (!kw) return props.members;
  return props.members.filter((member) => member.name.includes(kw) || member.role.includes(kw));
});

function isSelected(member: AdminMember): boolean {
  return props.modelValue.includes(member.id);
}

function toggleOption(member: AdminMember): void {
  const next = isSelected(member)
    ? props.modelValue.filter((id) => id !== member.id)
    : [...props.modelValue, member.id];
  emit("update:modelValue", next);
}

function clear(): void {
  emit("update:modelValue", []);
}

function updateAlignment(): void {
  const rootRect = root.value?.getBoundingClientRect();
  const boardRect = root.value?.closest(".board-body")?.getBoundingClientRect();
  alignRight.value = Boolean(rootRect && boardRect && rootRect.left + 268 > boardRect.right - 12);
}

function toggleOpen(): void {
  open.value = !open.value;
  if (open.value) {
    keyword.value = "";
    void nextTick(() => {
      updateAlignment();
      searchInput.value?.focus();
    });
  }
}

function onDocumentClick(event: MouseEvent): void {
  if (!open.value) return;
  if (event.target instanceof Node && root.value?.contains(event.target)) return;
  open.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !open.value) return;
  open.value = false;
  trigger.value?.focus();
}

document.addEventListener("click", onDocumentClick);
document.addEventListener("keydown", onDocumentKeydown);
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
  <div ref="root" class="fsel" :class="{ open }">
    <button
      ref="trigger"
      type="button"
      class="fsel-trigger"
      :class="{ 'has-value': hasSelection }"
      :aria-label="ariaLabel"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="toggleOpen"
    >
      <template v-if="firstSelected">
        <span class="ava" :style="{ background: firstSelected.color }" aria-hidden="true">{{ firstSelected.name.slice(0, 1) }}</span>
        <span class="names">{{ firstSelected.name }}<template v-if="overflowCount > 0"> +{{ overflowCount }}</template></span>
      </template>
      <span v-else-if="hasSelection" class="names">已选 {{ modelValue.length }} 人</span>
      <span v-else class="ph">全部</span>
      <span class="caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="fsel-panel" :class="{ 'align-right': alignRight }" role="dialog" :aria-label="ariaLabel">
      <input
        ref="searchInput"
        v-model="keyword"
        class="fsel-search"
        type="text"
        placeholder="搜索成员姓名 / 角色…"
        aria-label="搜索成员"
        @click.stop
      >
      <div class="fsel-list" role="listbox" :aria-label="ariaLabel" aria-multiselectable="true">
        <button
          v-for="member in filteredMembers"
          :key="member.id"
          type="button"
          class="fsel-opt"
          :class="{ sel: isSelected(member) }"
          role="option"
          :aria-selected="isSelected(member)"
          @click.stop="toggleOption(member)"
        >
          <span class="fsel-check" aria-hidden="true">{{ isSelected(member) ? "✓" : "" }}</span>
          <span class="ava" :style="{ background: member.color }" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
          <span class="opt-name">{{ member.name }}</span>
          <span class="role">{{ member.role }}</span>
        </button>
        <div v-if="filteredMembers.length === 0" class="fsel-empty">没有匹配的成员</div>
      </div>
      <div class="fsel-foot">
        <span class="sum">{{ hasSelection ? `已选 ${modelValue.length} 人` : "不筛选 = 全部负责人" }}</span>
        <button v-if="hasSelection" type="button" class="fsel-clear" @click.stop="clear">清除</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fsel {
  position: relative;
}

.fsel-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 132px;
  max-width: 216px;
  height: 29px;
  font: inherit;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 3px 8px 3px 9px;
  background: var(--bg-card);
}

.fsel-trigger:hover {
  border-color: var(--border-strong);
}

.fsel.open .fsel-trigger {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 12%, transparent);
}

.fsel-trigger.has-value {
  color: var(--blue);
  border-color: color-mix(in srgb, var(--blue) 45%, transparent);
  background: color-mix(in srgb, var(--blue) 7%, transparent);
  font-weight: 600;
}

.fsel-trigger .ph {
  color: var(--text-faint);
  font-weight: 400;
}

.fsel-trigger .names {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fsel-trigger .ava {
  width: 16px;
  height: 16px;
  font-size: 8.5px;
}

.fsel-trigger .caret {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 10px;
  padding-left: 2px;
}

.fsel-panel {
  position: absolute;
  top: calc(100% + 5px);
  left: 0;
  width: 268px;
  z-index: 40;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(20, 26, 38, 0.16);
  overflow: hidden;
}

.fsel-panel.align-right {
  left: auto;
  right: 0;
}

.fsel-search {
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 8px 12px;
  border: none;
  border-bottom: 1px solid var(--border);
  outline: none;
}

.fsel-list {
  max-height: 228px;
  overflow-y: auto;
  padding: 4px;
}

.fsel-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
}

.fsel-opt:hover {
  background: var(--bg-inset);
}

.fsel-opt.sel {
  background: color-mix(in srgb, var(--blue) 7%, transparent);
}

.fsel-opt .role {
  color: var(--text-faint);
  font-size: 10.5px;
  margin-left: auto;
}

.fsel-check {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: #fff;
  font-size: 10px;
  line-height: 1;
}

.fsel-opt.sel .fsel-check {
  border-color: var(--blue);
  background: var(--blue);
}

.fsel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid var(--border);
  background: #fafbfc;
}

.fsel-foot .sum {
  font-size: 10.5px;
  color: var(--text-faint);
}

.fsel-clear {
  font: inherit;
  font-size: 11px;
  color: var(--blue);
  background: transparent;
  border: none;
  border-radius: 5px;
  padding: 2px 5px;
  cursor: pointer;
}

.fsel-clear:hover {
  background: color-mix(in srgb, var(--blue) 9%, transparent);
}

.fsel-empty {
  padding: 14px;
  text-align: center;
  color: var(--text-faint);
  font-size: 11.5px;
}

.ava {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  color: #fff;
  font-weight: 600;
  flex: none;
  width: 18px;
  height: 18px;
  font-size: 9.5px;
}
</style>
