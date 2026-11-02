<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { AdminMember } from "@ztask/shared";

/**
 * 成员多选下拉（原型 .msel，1618–1697，D11）：框内成员 tag（头像+名+✕）+ 溢出 +N，
 * 面板内搜索 / 勾选 / 禁选原因（如「已是负责人」）。纯受控组件：
 * 选中集合由 v-model 传入，互斥逻辑（负责人/协作）由调用方处理。
 */
const props = defineProps<{
  /** 候选成员（活跃成员）。 */
  members: AdminMember[];
  /** 已选成员 id 集合。 */
  modelValue: string[];
  /** 未选时占位文案。 */
  placeholder: string;
  /** 返回禁选原因文案；null/空串表示可选。 */
  disabledReason?: (member: AdminMember) => string | null;
  /** 无障碍标签。 */
  ariaLabel: string;
}>();

const emit = defineEmits<{ "update:modelValue": [ids: string[]] }>();

const open = ref(false);
const keyword = ref("");
const root = ref<HTMLElement | null>(null);

const selectedMembers = computed(() =>
  props.modelValue
    .map((id) => props.members.find((member) => member.id === id))
    .filter((member): member is AdminMember => member !== undefined),
);
/** 框内最多展示 2 个 tag（原型 1628），其余折叠为 +N。 */
const shownMembers = computed(() => selectedMembers.value.slice(0, 2));
const overflowCount = computed(() => Math.max(0, selectedMembers.value.length - shownMembers.value.length));
const overflowTitle = computed(() =>
  selectedMembers.value.slice(2).map((member) => member.name).join("、"),
);

const filteredMembers = computed(() => {
  const kw = keyword.value.trim();
  if (!kw) return props.members;
  return props.members.filter((member) => member.name.includes(kw) || member.role.includes(kw));
});

function isSelected(member: AdminMember): boolean {
  return props.modelValue.includes(member.id);
}

function disabledText(member: AdminMember): string | null {
  return props.disabledReason?.(member) ?? null;
}

function toggleOption(member: AdminMember): void {
  if (disabledText(member)) return;
  const next = isSelected(member)
    ? props.modelValue.filter((id) => id !== member.id)
    : [...props.modelValue, member.id];
  emit("update:modelValue", next);
}

function removeMember(memberId: string): void {
  emit("update:modelValue", props.modelValue.filter((id) => id !== memberId));
}

function toggleOpen(): void {
  open.value = !open.value;
  if (open.value) keyword.value = "";
}

function onDocumentClick(event: MouseEvent): void {
  if (!open.value) return;
  if (event.target instanceof Node && root.value?.contains(event.target)) return;
  open.value = false;
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) {
    open.value = false;
  }
}

document.addEventListener("click", onDocumentClick);
document.addEventListener("keydown", onDocumentKeydown);
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
  <div ref="root" class="msel" :class="{ open }">
    <div class="msel-box" role="combobox" :aria-expanded="open" :aria-label="ariaLabel" @click="toggleOpen">
      <template v-if="selectedMembers.length">
        <span v-for="member in shownMembers" :key="member.id" class="msel-tag">
          <span class="ava" :style="{ background: member.color }" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
          {{ member.name }}
          <span
            class="x"
            role="button"
            :aria-label="`移除 ${member.name}`"
            title="移除"
            @click.stop="removeMember(member.id)"
          >✕</span>
        </span>
        <span v-if="overflowCount > 0" class="msel-tag more" :title="overflowTitle">+{{ overflowCount }}</span>
      </template>
      <span v-else class="msel-ph">{{ placeholder }}</span>
      <span class="msel-caret" aria-hidden="true">▾</span>
    </div>

    <div v-if="open" class="msel-panel">
      <input v-model="keyword" class="msel-search" type="text" placeholder="搜索成员姓名 / 角色…" @click.stop>
      <div class="msel-list" role="listbox" :aria-label="ariaLabel">
        <div
          v-for="member in filteredMembers"
          :key="member.id"
          class="msel-opt"
          :class="{ sel: isSelected(member), disabled: disabledText(member) }"
          role="option"
          :aria-selected="isSelected(member)"
          :aria-disabled="Boolean(disabledText(member))"
          @click="toggleOption(member)"
        >
          <span class="ava" :style="{ background: member.color }" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
          <span class="opt-name">{{ member.name }}</span>
          <span class="role">{{ member.role }}</span>
          <span v-if="disabledText(member)" class="tick disabled-reason">{{ disabledText(member) }}</span>
          <span v-else class="tick">{{ isSelected(member) ? "✓" : "" }}</span>
        </div>
        <div v-if="filteredMembers.length === 0" class="msel-empty">没有匹配的成员</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.msel {
  position: relative;
}

/* 原型 434–437。 */
.msel-box {
  min-height: 34px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--bg-card);
  cursor: pointer;
}

.msel-box:hover {
  border-color: var(--text-faint);
}

.msel.open .msel-box {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 14%, transparent);
}

.msel-ph {
  color: var(--text-faint);
  font-size: 12px;
  padding: 0 4px;
}

/* 原型 438–441：tag = 头像 + 名 + ✕；more 折叠 tag。 */
.msel-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 1.5px 5px 1.5px 2px;
  font-size: 11.5px;
}

.msel-tag .ava {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  flex: none;
}

.msel-tag .x {
  color: var(--text-faint);
  cursor: pointer;
  font-size: 10px;
  border-radius: 4px;
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
}

.msel-tag .x:hover {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
}

.msel-tag.more {
  color: var(--text-dim);
  background: var(--bg-card);
  cursor: default;
  font-family: var(--mono);
  font-size: 10.5px;
}

.msel-caret {
  margin-left: auto;
  color: var(--text-faint);
  font-size: 10px;
  padding: 0 4px;
}

/* 原型 443–453。 */
.msel-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(20, 26, 38, 0.16);
  overflow: hidden;
}

.msel-search {
  width: 100%;
  font: inherit;
  font-size: 12px;
  padding: 8px 12px;
  border: none;
  border-bottom: 1px solid var(--border);
  outline: none;
}

.msel-list {
  max-height: 208px;
  overflow-y: auto;
  padding: 4px;
}

.msel-opt {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12.5px;
}

.msel-opt:hover {
  background: var(--bg-inset);
}

.msel-opt .ava {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
  flex: none;
}

.opt-name {
  min-width: 0;
}

.role {
  color: var(--text-faint);
  font-size: 10.5px;
}

.tick {
  margin-left: auto;
  color: var(--blue);
  font-weight: 700;
  font-size: 12px;
}

.tick.disabled-reason {
  color: var(--text-faint);
  font-weight: 400;
  font-size: 10.5px;
}

.msel-opt.sel {
  background: color-mix(in srgb, var(--blue) 7%, transparent);
}

.msel-opt.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.msel-opt.disabled:hover {
  background: transparent;
}

.msel-empty {
  padding: 14px;
  text-align: center;
  color: var(--text-faint);
  font-size: 11.5px;
}
</style>
