<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { ApiError, type Importance, type ShareTaskMutation, type Subtask, type Task } from "@ztask/shared";
import { isOverdue } from "../../components/task-card-model";
import { shareApi } from "../../api/share";
import { useToast } from "../../components/ui/toast";
import BaseDialog from "../../components/ui/BaseDialog.vue";

/**
 * 成员视图任务卡（原型 1851–1886、1892–1910，08 §6.2）：
 * - 只读形态（协作任务 / 只读跟踪）：展示重要度、任务夹路径（原型为无样式内联文本，D17）、
 *   负责人与协作（头像组）、预计完成、小任务摘要、进度与完整进展详情，不渲染任何输入控件。
 * - 可编辑形态（我负责的，D13）：左 240px 灰底进度面板（含蓝色 mono % 值）+ 右侧进展详情，
 *   foot =「保存进度」+「✓ 已保存」瞬时反馈 + 生效时机提示；小任务可新建/编辑/删除（B-4 增强）。
 *   进度滑块只改本地草稿，点击「保存进度」才提交；详情独立保存；所有写操作携带聚合 version，
 *   409 时保留草稿并提示刷新。
 * 分配、重要度、预计完成、所在任务夹与主任务描述永不提供编辑入口（02 §4.2）。
 */
const props = defineProps<{
  /** 分享域返回的主任务聚合。 */
  task: Task;
  /** 协作任务标记：为 true 时追加「协作任务 · 只读」徽标。 */
  readonly?: boolean;
  /** 由调用方用可见任务夹树算出的路径（如「迭代 / 子夹」），省略时不渲染。 */
  folderPath?: string;
  /** 是否展示 owner 编辑控件（只有「我负责的」卡片为 true）。 */
  editable?: boolean;
}>();

const queryClient = useQueryClient();
const toast = useToast();

const IMPORTANCE_NAMES: Record<Importance, string> = { high: "高", mid: "中", low: "低" };
const IMPORTANCES: readonly Importance[] = ["high", "mid", "low"];

const overdue = computed(() => isOverdue({ dueDate: props.task.dueDate, progress: props.task.progress }));
const dueLabel = computed(() => {
  if (props.task.dueDate === null) return "未设置";
  const [, month, day] = props.task.dueDate.split("-");
  return `${Number(month)}-${day}`;
});
const detailText = computed(() => props.task.detail || "（暂无进展记录）");

/** 进度草稿：只有点击「保存进度」才提交；父级数据在未编辑时同步（例如他人保存后轮询）。 */
const progressDraft = ref(props.task.progress);
/** 完整详情草稿：独立保存，保存成功前不覆盖父级。 */
const detailDraft = ref(props.task.detail);
/** 409 冲突提示：保留草稿，等用户选择放弃草稿后刷新。 */
const conflict = ref<string | null>(null);
/** 冲突横幅节点：出现时把焦点移过去，屏幕阅读器与键盘用户都能立刻感知。 */
const conflictEl = ref<HTMLElement | null>(null);
/**
 * 草稿基线版本：第一次编辑时锁定当时的聚合 version。
 * 若提交时才读 props.task.version，「旧草稿 + 新版本号」会绕过 409 静默覆盖别人的新内容。
 */
const progressBaseVersion = ref<number | null>(null);
const detailBaseVersion = ref<number | null>(null);
/** 小任务行内编辑器；null 表示未打开。id 为 null 表示新建。 */
const subtaskEditor = ref<{
  id: string | null;
  description: string;
  progress: number;
  importance: Importance;
  dueDate: string;
  baseVersion: number;
} | null>(null);
/** 待确认删除的小任务。 */
const deletingSubtask = ref<Subtask | null>(null);

watch(
  () => props.task.progress,
  (value, oldValue) => {
    // 用户草稿未保存（draft 仍等于旧基线 → false；已改动 → 不覆盖）时不被轮询/他人保存覆盖。
    if (progressDraft.value !== oldValue) return;
    progressDraft.value = value;
  },
);

watch(
  () => props.task.detail,
  (value, oldValue) => {
    // 同上：只有用户没有改动详情时才跟随服务端事实。
    if (detailDraft.value !== oldValue) return;
    detailDraft.value = value;
  },
);

const progressDirty = computed(() => progressDraft.value !== props.task.progress);
const detailDirty = computed(() => detailDraft.value !== props.task.detail);

/** 「✓ 已保存」瞬时反馈（原型 .saved 的淡入淡出，1.8s）。 */
const savedFlash = ref(false);
let savedTimer: ReturnType<typeof setTimeout> | undefined;

function flashSaved(): void {
  savedFlash.value = true;
  if (savedTimer !== undefined) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedFlash.value = false;
  }, 1800);
}

watch(conflict, async (value) => {
  if (value === null) return;
  await nextTick();
  conflictEl.value?.focus();
});

/** 用户开始改进度：锁定当前聚合版本作为提交基线。 */
function onProgressInput(): void {
  if (progressBaseVersion.value === null) progressBaseVersion.value = props.task.version;
}

/** 用户开始改详情：锁定当前聚合版本作为提交基线。 */
function onDetailInput(): void {
  if (detailBaseVersion.value === null) detailBaseVersion.value = props.task.version;
}

/** 写后刷新：home 与 tracker 都从同一组 share 缓存派生。 */
function invalidateShareTasks(): void {
  void queryClient.invalidateQueries({ queryKey: ["share", "tasks"] });
}

/**
 * 写操作统一错误面：409 保留草稿并提示刷新；其余错误直接 toast。
 * @param cause useMutation 抛出的错误。
 */
function handleWriteError(cause: unknown, operation: string): void {
  if (cause instanceof ApiError && cause.code === "TASK_VERSION_CONFLICT") {
    const current = (cause.details as { current?: { version?: number; progress?: number } } | null)?.current;
    const serverFact =
      current?.version !== undefined
        ? `服务器当前是 v${current.version}${current.progress !== undefined ? ` · 进度 ${current.progress}%` : ""}`
        : "服务器已有新版本";
    conflict.value = `${operation}保存冲突：${serverFact}；你的草稿已保留，可选择放弃草稿并刷新。`;
    return;
  }
  if (cause instanceof ApiError && cause.code === "TASK_NOT_FOUND" && subtaskEditor.value !== null) {
    // 编辑期间小任务被管理员删除：关闭编辑器，避免对着已不存在的对象继续保存。
    subtaskEditor.value = null;
  }
  toast.show(cause instanceof Error ? cause.message : "保存失败");
}

const progressMutation = useMutation({
  mutationFn: () =>
    shareApi.saveProgress(props.task.id, {
      progress: progressDraft.value,
      version: progressBaseVersion.value ?? props.task.version,
    }),
  onSuccess: (result: ShareTaskMutation) => {
    conflict.value = null;
    progressBaseVersion.value = null;
    progressDraft.value = result.task.progress;
    flashSaved();
    toast.show("进度已保存");
    invalidateShareTasks();
  },
  onError: (cause: unknown) => handleWriteError(cause, "进度"),
});

const detailMutation = useMutation({
  mutationFn: () =>
    shareApi.saveDetail(props.task.id, {
      detail: detailDraft.value,
      version: detailBaseVersion.value ?? props.task.version,
    }),
  onSuccess: (result: ShareTaskMutation) => {
    conflict.value = null;
    detailBaseVersion.value = null;
    detailDraft.value = result.task.detail;
    flashSaved();
    toast.show("进展详情已保存");
    invalidateShareTasks();
  },
  onError: (cause: unknown) => handleWriteError(cause, "详情"),
});

const saveSubtaskMutation = useMutation({
  mutationFn: async (draft: NonNullable<typeof subtaskEditor.value>) => {
    const body = {
      version: draft.baseVersion,
      description: draft.description,
      progress: draft.progress,
      importance: draft.importance,
      dueDate: draft.dueDate === "" ? null : draft.dueDate,
    };
    return draft.id === null
      ? await shareApi.createSubtask(props.task.id, body)
      : await shareApi.updateSubtask(props.task.id, draft.id, body);
  },
  onSuccess: () => {
    subtaskEditor.value = null;
    conflict.value = null;
    toast.show("小任务已保存");
    invalidateShareTasks();
  },
  onError: (cause: unknown) => handleWriteError(cause, "小任务"),
});

const deleteSubtaskMutation = useMutation({
  mutationFn: (subtaskId: string) => shareApi.deleteSubtask(props.task.id, subtaskId, props.task.version),
  onSuccess: () => {
    deletingSubtask.value = null;
    conflict.value = null;
    toast.show("小任务已删除");
    invalidateShareTasks();
  },
  onError: (cause: unknown) => {
    deletingSubtask.value = null;
    handleWriteError(cause, "小任务");
  },
});

/**
 * 小任务完成标记：100% 用实心方框，其余空心（原型 .sub-ro 的 ☑/☐ 形状）。
 * @param progress 小任务进度。
 * @returns 是否已完成。
 */
function isDone(progress: number): boolean {
  return progress >= 100;
}

function openCreateSubtask(): void {
  conflict.value = null;
  subtaskEditor.value = {
    id: null,
    description: "",
    progress: 0,
    importance: "mid",
    dueDate: "",
    baseVersion: props.task.version,
  };
}

function openEditSubtask(subtask: Subtask): void {
  conflict.value = null;
  subtaskEditor.value = {
    id: subtask.id,
    description: subtask.description,
    progress: subtask.progress,
    importance: subtask.importance,
    dueDate: subtask.dueDate ?? "",
    baseVersion: props.task.version,
  };
}

function saveSubtask(): void {
  const draft = subtaskEditor.value;
  if (!draft || draft.description.trim() === "") {
    toast.show("小任务描述不能为空");
    return;
  }
  saveSubtaskMutation.mutate(draft);
}

function confirmDeleteSubtask(): void {
  if (!deletingSubtask.value) return;
  deleteSubtaskMutation.mutate(deletingSubtask.value.id);
}

/** 冲突后放弃草稿并刷新：清空所有草稿与基线，避免用旧草稿覆盖服务端新版本。 */
function discardDraftsAndRefresh(): void {
  conflict.value = null;
  progressDraft.value = props.task.progress;
  detailDraft.value = props.task.detail;
  subtaskEditor.value = null;
  progressBaseVersion.value = null;
  detailBaseVersion.value = null;
  void queryClient.refetchQueries({ queryKey: ["share", "tasks"] });
}
</script>

<template>
  <article class="stask" :class="{ readonly }">
    <div class="r1">
      <span class="imp-dot" :class="task.importance" aria-hidden="true" />
      <span class="desc">{{ task.description }}</span>
      <span v-if="folderPath" class="folder-path">📁 {{ folderPath }}</span>
      <span class="imp" :class="task.importance">重要度 · {{ IMPORTANCE_NAMES[task.importance] }}</span>
      <span v-if="readonly" class="ro-tag">协作任务 · 只读</span>
    </div>

    <div class="meta">
      <span>
        <span class="k">负责人</span>
        <span class="ava-group">
          <span v-for="owner in task.owners" :key="owner.id" class="ava" :style="{ background: owner.color }" :title="`${owner.name} · ${owner.role}`">{{ owner.name.slice(0, 1) }}</span>
        </span>
        <span v-if="task.owners.length === 0">—</span>
      </span>
      <span v-if="task.collaborators.length">
        <span class="k">协作</span>
        <span class="ava-group">
          <span v-for="member in task.collaborators" :key="member.id" class="ava" :style="{ background: member.color }" :title="`${member.name} · ${member.role}`">{{ member.name.slice(0, 1) }}</span>
        </span>
      </span>
      <span>
        <span class="k">预计完成</span>
        <span class="due" :class="{ overdue }">{{ dueLabel }}</span>
        <span v-if="overdue" class="overdue-tag">已逾期</span>
      </span>
    </div>

    <ul v-if="task.subtasks.length" class="sub-ro" aria-label="小任务摘要">
      <li v-for="subtask in task.subtasks" :key="subtask.id" :class="{ done: isDone(subtask.progress) }">
        <span class="st" aria-hidden="true">{{ isDone(subtask.progress) ? "☑" : "☐" }}</span>
        <span class="sd">{{ subtask.description }}</span>
        <span class="st">{{ subtask.progress }}%</span>
        <span v-if="editable" class="sub-actions">
          <button class="mini-btn" type="button" @click="openEditSubtask(subtask)">编辑</button>
          <button class="mini-btn red" type="button" @click="deletingSubtask = subtask">删除</button>
        </span>
      </li>
    </ul>

    <!-- 可编辑形态：进度只改草稿，详情独立保存（02 §4.2、08 §6.2）。 -->
    <template v-if="editable">
      <p v-if="conflict" ref="conflictEl" class="conflict" role="alert" tabindex="-1">
        <span>{{ conflict }}</span>
        <button class="mini-btn" type="button" @click="discardDraftsAndRefresh">放弃草稿并刷新</button>
      </p>

      <!-- D13（原型 1867–1885）：左 240px 灰底进度面板（含蓝色 mono % 值）+ 右进展详情。 -->
      <div class="edit-row">
        <div class="pedit">
          <label class="plabel" :for="`progress-${task.id}`">进度</label>
          <input
            :id="`progress-${task.id}`"
            v-model.number="progressDraft"
            type="range"
            min="0"
            max="100"
            step="5"
            @input="onProgressInput"
          >
          <span class="pv">{{ progressDraft }}%</span>
        </div>
        <div class="detail-col">
          <textarea
            :id="`detail-${task.id}`"
            v-model="detailDraft"
            class="detail-input"
            :aria-label="`进展详情：${task.description}`"
            placeholder="记录当前进展、阻塞点、下一步计划…（保存会追加一份新的完整快照）"
            @input="onDetailInput"
          />
        </div>
      </div>

      <!-- D13（原型 1881–1885）：foot = 保存按钮 + 「✓ 已保存」瞬时反馈 + 生效时机提示。 -->
      <div class="foot">
        <button
          class="btn primary"
          type="button"
          :disabled="!progressDirty || progressMutation.isPending.value"
          @click="progressMutation.mutate()"
        >
          {{ progressMutation.isPending.value ? "保存中…" : "保存进度" }}
        </button>
        <button
          class="btn ghost"
          type="button"
          :disabled="!detailDirty || detailMutation.isPending.value"
          @click="detailMutation.mutate()"
        >
          {{ detailMutation.isPending.value ? "保存中…" : "保存详情" }}
        </button>
        <span class="saved" :class="{ show: savedFlash }">✓ 已保存</span>
        <span class="foot-hint">进度调整需点击「保存进度」后生效；详情保存会追加一份完整快照</span>
      </div>

      <div class="sub-edit-area">
        <div class="sub-add">
          <button class="btn ghost" type="button" @click="openCreateSubtask">＋ 添加小任务</button>
          <span class="edit-hint">只能创建一层小任务；负责人固定为你自己。</span>
        </div>

        <div v-if="subtaskEditor" class="sub-editor">
          <input v-model="subtaskEditor.description" class="sub-desc" placeholder="小任务描述…" aria-label="小任务描述">
          <input
            v-model.number="subtaskEditor.progress"
            type="number"
            min="0"
            max="100"
            step="5"
            class="sub-progress"
            aria-label="小任务进度"
          >
          <select v-model="subtaskEditor.importance" class="sub-importance" aria-label="小任务重要度">
            <option v-for="level in IMPORTANCES" :key="level" :value="level">{{ IMPORTANCE_NAMES[level] }}</option>
          </select>
          <input v-model="subtaskEditor.dueDate" type="date" class="sub-due" aria-label="小任务预计完成">
          <button
            class="btn primary"
            type="button"
            :disabled="saveSubtaskMutation.isPending.value"
            @click="saveSubtask"
          >
            {{ saveSubtaskMutation.isPending.value ? "保存中…" : subtaskEditor.id === null ? "添加" : "保存" }}
          </button>
          <button class="btn ghost" type="button" @click="subtaskEditor = null">取消</button>
        </div>
        <p v-if="task.subtasks.length === 0 && !subtaskEditor" class="sub-empty">还没有小任务。</p>
      </div>
    </template>

    <div v-else class="read-row">
      <div class="progress-panel">
        <span class="progress-label">进度</span>
        <span
          class="prog"
          role="progressbar"
          :aria-valuenow="task.progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`任务进度 ${task.progress}%`"
        >
          <span class="track"><span class="fill" :class="{ done: task.progress >= 100 }" :style="{ width: `${task.progress}%` }" /></span>
          <span class="pct">{{ task.progress }}%</span>
        </span>
      </div>
      <pre class="detail-view">{{ detailText }}</pre>
    </div>

    <BaseDialog :open="deletingSubtask !== null" title="删除小任务" @close="deletingSubtask = null">
      <p class="confirm-text">删除小任务「{{ deletingSubtask?.description }}」？历史记录保留，操作可追溯。</p>
      <template #foot>
        <span class="sp" />
        <button class="btn ghost" type="button" @click="deletingSubtask = null">取消</button>
        <button
          class="btn danger-btn"
          type="button"
          :disabled="deleteSubtaskMutation.isPending.value"
          @click="confirmDeleteSubtask"
        >
          {{ deleteSubtaskMutation.isPending.value ? "删除中…" : "确认删除" }}
        </button>
      </template>
    </BaseDialog>
  </article>
</template>

<style scoped>
.stask {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: var(--shadow);
  margin-bottom: 12px;
}

.r1 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.r1 .desc {
  font-size: 13.5px;
  font-weight: 650;
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.imp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.imp-dot.high {
  background: var(--red);
}

.imp-dot.mid {
  background: var(--orange);
}

.imp-dot.low {
  background: #8a93a1;
}

/* D17（原型 1855）：路径为无样式内联文本，不做 chip。 */
.folder-path {
  flex: none;
}

.imp {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  padding: 1px 8px;
  white-space: nowrap;
}

.imp.high {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 11%, transparent);
}

.imp.mid {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 13%, transparent);
}

.imp.low {
  color: var(--text-dim);
  background: color-mix(in srgb, #5a6372 12%, transparent);
}

.ro-tag {
  flex: none;
  font-size: 10.5px;
  color: var(--text-faint);
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
  padding: 1px 9px;
}

.meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11.5px;
  color: var(--text-dim);
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.meta .k {
  color: var(--text-faint);
  margin-right: 3px;
}

/* D17（原型 79–80/1860–1861）：负责人/协作 = 头像组，18px、-6px 叠放、2px 白描边。 */
.ava-group {
  display: inline-flex;
  vertical-align: middle;
}

.meta .ava {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-size: 9.5px;
  font-weight: 600;
}

.ava-group .ava + .ava {
  margin-left: -6px;
  box-shadow: 0 0 0 2px #fff;
}

.due {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-dim);
  white-space: nowrap;
}

.due.overdue {
  color: var(--red);
  font-weight: 600;
}

.overdue-tag {
  font-size: 10px;
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
  border-radius: 4px;
  padding: 0 5px;
  margin-left: 4px;
}

.sub-ro {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
}

.sub-ro li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: var(--text-dim);
  padding: 2px 0;
}

.sub-ro li .st {
  font-family: var(--mono);
  font-size: 10.5px;
  flex: none;
}

/* R8-D2（原型 405–406）：原型 .sd 自然宽，百分比紧跟描述右侧（gap 7px）而非被推到行尾；
 * 行尾对齐交给下方 .sub-actions 的 margin-left:auto（可编辑卡的增能按钮），长描述仍可收缩换行。 */
.sub-ro li .sd {
  flex: 0 1 auto;
  min-width: 0;
  word-break: break-word;
}

.sub-ro li.done .sd {
  text-decoration: line-through;
  color: var(--text-faint);
}

.sub-actions {
  display: inline-flex;
  gap: 6px;
  flex: none;
  margin-left: auto;
}

.mini-btn {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 1.5px 8px;
  cursor: pointer;
  white-space: nowrap;
}

.mini-btn:hover {
  color: var(--text);
  background: var(--bg-inset);
}

.mini-btn.red {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 40%, transparent);
}

.read-row {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 14px;
  align-items: start;
  margin-top: 10px;
}

.progress-panel {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--bg-inset);
  border-radius: 9px;
  padding: 9px 12px;
}

.progress-label {
  font-size: 11px;
  color: var(--text-faint);
  flex: none;
}

.prog {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 1;
  min-width: 0;
}

.prog .track {
  display: block;
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: #e8ebf0;
  overflow: hidden;
  min-width: 40px;
}

.prog .fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #6f9bff, var(--blue));
}

.prog .fill.done {
  background: linear-gradient(90deg, #43c58d, var(--green));
}

.prog .pct {
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--blue);
  width: 40px;
  text-align: right;
  flex: none;
}

.detail-view {
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-inset);
  border-radius: 9px;
  padding: 9px 12px;
  white-space: pre-wrap;
  line-height: 1.7;
  margin: 0;
  word-break: break-word;
}

/* ── owner 编辑形态 ─────────────────────────────────────────────── */
.conflict {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 8px 0 0;
  padding: 7px 10px;
  font-size: 11.5px;
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--orange) 35%, transparent);
  border-radius: 8px;
}

/* D13（原型 396）：编辑行 = 240px 进度面板 + 1fr 详情。 */
.edit-row {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 14px;
  align-items: start;
  margin-top: 10px;
}

/* 原型 397：灰底圆角进度面板。 */
.pedit {
  display: flex;
  align-items: center;
  gap: 9px;
  background: var(--bg-inset);
  border-radius: 9px;
  padding: 9px 12px;
}

.plabel {
  font-size: 11px;
  color: var(--text-faint);
  flex: none;
}

.pedit input[type="range"] {
  flex: 1;
  min-width: 0;
  accent-color: var(--blue);
}

/* 原型 399：蓝色 mono 百分比值。 */
.pv {
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--blue);
  width: 40px;
  text-align: right;
  flex: none;
}

.detail-col {
  min-width: 0;
}

.detail-input {
  width: 100%;
  min-height: 86px;
  resize: vertical;
  font: inherit;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text);
  background: var(--bg-inset);
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 8px 10px;
  box-sizing: border-box;
}

.detail-input:focus {
  outline: none;
  border-color: var(--blue);
  background: var(--bg-card);
}

/* 原型 414–415：foot = 保存按钮 + 淡入淡出的「✓ 已保存」+ 提示行。 */
.foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}

.saved {
  font-size: 11px;
  color: var(--green);
  opacity: 0;
  transition: opacity 0.2s;
}

.saved.show {
  opacity: 1;
}

.foot-hint {
  font-size: 11px;
  color: var(--text-faint);
}

.edit-hint {
  font-size: 10.5px;
  color: var(--text-faint);
}

.btn {
  font: inherit;
  font-size: 12px;
  border-radius: 7px;
  padding: 5px 12px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.btn.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.btn.ghost {
  border-color: transparent;
  color: var(--text-dim);
}

.btn.danger-btn {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
}

.sub-edit-area {
  margin-top: 12px;
  border-top: 1px dashed var(--border);
  padding-top: 10px;
}

.sub-add {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sub-editor {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 10px;
}

.sub-desc {
  flex: 1;
  min-width: 160px;
  font: inherit;
  font-size: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 8px;
}

.sub-progress {
  width: 68px;
  font: inherit;
  font-size: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 8px;
}

.sub-importance,
.sub-due {
  font: inherit;
  font-size: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 8px;
  color: var(--text);
}

.sub-empty {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--text-faint);
}

.confirm-text {
  font-size: 12.5px;
  color: var(--text-dim);
}

.sp {
  flex: 1;
}

@media (max-width: 720px) {
  .read-row,
  .edit-row {
    grid-template-columns: 1fr;
  }
}
</style>
