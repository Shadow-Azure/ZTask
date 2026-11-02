<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import type { FolderTreeNode } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";
import FolderTreeCreateRow from "./FolderTreeCreateRow.vue";

/**
 * 递归树节点（08 §2.2、原型 149–174/1094–1125）：
 * 行 = ▾ + 📂/📁 + 夹名 + ✓N(绿) ○M(红) mono 计数；行 click 选择（写 URL folder）并展开，
 * chev 单击仅折叠；双击行内重命名（仅管理员，web 增强）。
 * 夹下缩进渲染任务行：重要度色点（mid/low 弱化）+ 任务名 + 18px 进度环 + mono 百分比，
 * 点击任务行向上发 open-task（管理端开编辑浮窗 / 成员端开只读详情）。
 * 「＋ 新建任务夹」的行内输入由本节点渲染在选中夹的 `.tchildren` 末尾（原型 1120–1121）；
 * 树 DTO 来自服务端，不递归请求。
 */
const props = defineProps<{
  node: FolderTreeNode;
  depth: number;
  canEdit?: boolean;
  /** 是否处于树内新建任务夹态（由 TrackerView 的树头按钮开启）。 */
  creating?: boolean;
  /** 新建行的父夹 id；等于本节点 id 时在子层末尾渲染新建行。 */
  createParentId?: string | null;
}>();

const emit = defineEmits<{ "open-task": [taskId: string]; "close-create": [] }>();

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const toast = useToast();

const collapsed = ref(false);
const renaming = ref(false);
const renameValue = ref("");

/** 原型 1128：点「＋ 新建任务夹」会先展开选中夹，新建行才落在可见的子层里。 */
watch(
  () => props.createParentId,
  (parentId) => {
    if (parentId === props.node.id) collapsed.value = false;
  },
);

const isSelected = computed(() => route.query.folder === props.node.id);
/** 原型：夹内先列子夹、再列任务行。 */
const hasChildren = computed(() => props.node.children.length > 0);
const hasTasks = computed(() => props.node.tasks.length > 0);
/**
 * 行尾 ✓/○ 计数按整棵子树聚合（原型 1031 行 taskIdsOf 递归收集后代任务 +
 * 1096 行 summarizeTaskCounts）。服务端 `counts` 只有直属任务口径，若原样展示，
 * 「只有子夹任务」的父夹会整块不渲染（R4-D6）。这里直接用 DTO 里的 tasks 递归求和，
 * 不依赖服务端 counts 口径，避免将来服务端改成聚合后重复计数。
 */
const subtreeCounts = computed(() => {
  let done = 0;
  let total = 0;
  const walk = (node: FolderTreeNode): void => {
    for (const task of node.tasks) {
      total += 1;
      if (task.progress >= 100) done += 1;
    }
    for (const child of node.children) walk(child);
  };
  walk(props.node);
  return { done, todo: total - done };
});

function select(): void {
  // 原型 1068：选中即展开，保持左右信息一致。
  collapsed.value = false;
  void router.replace({ query: { ...route.query, folder: props.node.id } });
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value;
}

const renameMutation = useMutation({
  mutationFn: (input: { id: string; name: string }) => adminApi.renameFolder(input.id, input.name),
  onSuccess: () => {
    renaming.value = false;
    void queryClient.invalidateQueries({ queryKey: ["admin", "folders"] });
    toast.show("已重命名任务夹");
  },
  onError: (cause: unknown) => {
    toast.show(cause instanceof Error ? cause.message : "重命名失败");
  },
});

function submitRename(): void {
  const name = renameValue.value.trim();
  if (!name || renameMutation.isPending.value) return;
  renameMutation.mutate({ id: props.node.id, name });
}

/** 树内 18px 进度环（原型 treeProgressHtml，r=7、stroke 2.2）。 */
const RING_RADIUS = 7;
const ringCircumference = 2 * Math.PI * RING_RADIUS;
function ringOffset(progress: number): string {
  const clamped = Math.max(0, Math.min(100, progress));
  return (ringCircumference * (1 - clamped / 100)).toFixed(2);
}
</script>

<template>
  <li class="tree-node" role="treeitem" :aria-expanded="hasChildren ? String(!collapsed) : undefined">
    <div class="row" :class="{ selected: isSelected }" @click="select">
      <span
        class="chev"
        :style="{ transform: `rotate(${collapsed ? -90 : 0}deg)` }"
        :aria-label="(collapsed ? '展开' : '折叠') + node.name"
        @click.stop="hasChildren ? toggleCollapsed() : undefined"
      >▾</span>
      <span class="ficon" aria-hidden="true">{{ collapsed ? "📁" : "📂" }}</span>
      <button
        class="name"
        type="button"
        :title="node.name"
        @click.stop="select"
        @dblclick="canEdit ? ((renaming = true), (renameValue = node.name)) : undefined"
      >
        {{ node.name }}
      </button>
      <span
        v-if="subtreeCounts.done + subtreeCounts.todo > 0"
        class="folder-counts"
        :title="`已完成 ${subtreeCounts.done} 个，未完成 ${subtreeCounts.todo} 个`"
      >
        <span class="done"><span class="status-ic">✓</span>{{ subtreeCounts.done }}</span>
        <span class="todo"><span class="status-ic">○</span>{{ subtreeCounts.todo }}</span>
      </span>
    </div>
    <input
      v-if="renaming"
      v-model="renameValue"
      class="rename-input"
      aria-label="重命名任务夹"
      @keydown.enter="submitRename"
      @keydown.escape="renaming = false"
    >
    <ul v-if="!collapsed" class="tchildren" role="group">
      <FolderTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :can-edit="canEdit"
        :creating="creating"
        :create-parent-id="createParentId"
        @open-task="(id: string) => emit('open-task', id)"
        @close-create="emit('close-create')"
      />
      <button
        v-for="task in node.tasks"
        :key="task.id"
        class="row task"
        type="button"
        :title="`点击打开任务详情：${task.description}`"
        @click="emit('open-task', task.id)"
      >
        <span class="chev" aria-hidden="true" />
        <span class="imp-dot" :class="task.importance" aria-hidden="true" />
        <span class="tname" :title="task.description">{{ task.description }}</span>
        <span
          class="tree-progress"
          role="progressbar"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="task.progress"
          :aria-label="`${task.description}，进度 ${task.progress}%`"
          title="任务进度（只读）"
        >
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <circle class="ring-track" cx="9" cy="9" :r="RING_RADIUS" />
            <circle
              class="ring-value"
              :class="{ done: task.progress === 100 }"
              cx="9"
              cy="9"
              :r="RING_RADIUS"
              :stroke-dasharray="ringCircumference.toFixed(2)"
              :stroke-dashoffset="ringOffset(task.progress)"
            />
          </svg>
          <span class="tree-progress-value">{{ task.progress }}%</span>
        </span>
      </button>
      <!-- 原型 1120–1121：新建行渲染在当前夹子层的末尾（子夹/任务之后）。 -->
      <FolderTreeCreateRow
        v-if="creating && createParentId === node.id"
        :parent-id="node.id"
        @close="emit('close-create')"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree-node,
.tchildren {
  list-style: none;
}

/* 原型 174：子级缩进 + 虚线引导线。 */
.tchildren {
  margin: 0;
  padding: 0 0 0 4px;
  margin-left: 15px;
  border-left: 1px dashed #dde1e8;
}

/* 原型 150–156：12.5px 行、6px 间距、7px 圆角、hover 浅灰。 */
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4.5px 8px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 12.5px;
  color: var(--text);
  user-select: none;
}

.row:hover {
  background: #eceff4;
}

.row.selected {
  background: color-mix(in srgb, var(--blue) 11%, transparent);
  color: var(--blue);
  font-weight: 600;
}

/* 原型 156：chev 是行内字符，非独立按钮；折叠时旋转 -90°。 */
.chev {
  width: 14px;
  text-align: center;
  color: var(--text-faint);
  font-size: 10px;
  flex: none;
  transition: transform 0.12s;
  cursor: pointer;
}

.ficon {
  flex: none;
}

.name {
  border: none;
  background: transparent;
  font: inherit;
  color: inherit;
  padding: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

/* 原型 158–161：mono 10.5px/650 计数；✓ 绿 / ○ 红。 */
.folder-counts {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  flex: none;
}

.folder-counts .done {
  color: var(--green);
}

.folder-counts .todo {
  color: var(--red);
}

.folder-counts .status-ic {
  margin-right: 2px;
  font-size: 9px;
}

/* ── 任务行（原型 162–171）─────────────────────────── */
/* 任务行是 <button>，需重置 UA 字体；但 `font: inherit` 会把 .row 的 12.5px 一并覆盖回继承的
 * 13px（特异性 .row.task > .row），故只重置字体族与行高，字号由 .row 保留（R3-D5，原型 150/162）。 */
.row.task {
  color: var(--text-dim);
  gap: 5px;
  width: 100%;
  border: none;
  background: transparent;
  font-family: inherit;
  line-height: inherit;
  text-align: left;
}

/* 任务行的 hover 底色：`.row.task` 的 background 与 `.row:hover` 同特异性且声明在后，
 * 会把夹行的 hover 底色覆盖掉；此处用更高特异性补回（R6-D2，原型 `.trow:hover` 同样作用于任务行）。 */
.row.task:hover {
  background: #eceff4;
}

.imp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: none;
}

.imp-dot.high {
  background: var(--red);
}

.imp-dot.mid {
  background: var(--orange);
}

.imp-dot.low {
  background: var(--imp-low);
}

/* 原型 171：树内 mid/low 色点弱化。 */
.row.task .imp-dot.mid,
.row.task .imp-dot.low {
  background: var(--imp-dim);
}

.tname {
  flex: 1;
  min-width: 64px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}

.tree-progress {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  width: 49px;
  flex: none;
}

.tree-progress svg {
  width: 18px;
  height: 18px;
  flex: none;
}

.ring-track {
  fill: none;
  stroke: #e0e5ec;
  stroke-width: 2.2;
}

.ring-value {
  fill: none;
  stroke: var(--blue);
  stroke-width: 2.2;
  stroke-linecap: round;
  transform: rotate(-90deg);
  transform-origin: 9px 9px;
  transition: stroke-dashoffset 0.18s ease;
}

.ring-value.done {
  stroke: var(--green);
}

.tree-progress-value {
  width: 28px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 9.5px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.row.task:hover .tree-progress-value {
  color: var(--text-dim);
}

.rename-input {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--blue);
  border-radius: 6px;
  padding: 2px 6px;
  width: calc(100% - 20px);
  margin: 2px 0 2px 20px;
  background: var(--bg-card);
  color: var(--text);
}
</style>
