<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { ShareMemberRole, ShareTaskDetail, Subtask, Task } from "@ztask/shared";
import { shareApi } from "../../api/share";
import BaseDialog from "../../components/ui/BaseDialog.vue";
import ImportanceMark from "../../components/ui/ImportanceMark.vue";
import ProgressRing from "../../components/ui/ProgressRing.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import LoadingState from "../../components/ui/LoadingState.vue";

/**
 * 成员只读任务详情浮窗（08 §6.3、03 §5、05 §6.5）：复用 BaseDialog 的头部与焦点管理，
 * 字段布局与 TaskEditorDialog 同构，但不含任何输入、保存、删除或追加控件——成员在事项跟踪
 * 只能查看；即使任务属于当前成员，更新入口也只在其个人页（02 §5）。
 * 数据在打开时才请求：主任务形态 `Task + memberRole`，小任务形态 `{ task, parent, memberRole }`。
 */
const props = defineProps<{
  open: boolean;
  /** 目标任务 id（主任务或小任务）；null 表示没有可展示对象。 */
  taskId: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

/** query key 依赖任务 id：关闭时父级置 null，旧数据不会串到下一次打开。 */
const taskIdKey = computed(() => props.taskId);

const detailQuery = useQuery({
  queryKey: ["share", "tasks", "detail", taskIdKey],
  queryFn: () => shareApi.task(props.taskId ?? ""),
  enabled: computed(() => props.open && props.taskId !== null),
});

/** 小任务详情形态（05 §6.5）：携带只含成员可见小任务的父任务。 */
interface SubtaskDetail {
  task: Subtask;
  parent: Task;
  memberRole: ShareMemberRole;
}

function isSubtaskDetail(value: ShareTaskDetail): value is SubtaskDetail {
  return "task" in value;
}

const detail = computed<ShareTaskDetail | null>(() => detailQuery.data.value ?? null);
const mainTask = computed<Task | null>(() => {
  const value = detail.value;
  return value !== null && !isSubtaskDetail(value) ? value : null;
});
const subtaskDetail = computed<SubtaskDetail | null>(() => {
  const value = detail.value;
  return value !== null && isSubtaskDetail(value) ? value : null;
});

const description = computed(() => mainTask.value?.description ?? subtaskDetail.value?.task.description ?? "");
const parentDescription = computed(() => subtaskDetail.value?.parent.description ?? null);
const ownerNames = computed(() => {
  const owners = mainTask.value?.owners ?? (subtaskDetail.value ? [subtaskDetail.value.task.owner] : []);
  return owners.map((owner) => owner.name).join("、") || "待分配";
});
const collaboratorNames = computed(() => mainTask.value?.collaborators.map((member) => member.name).join("、") ?? "");
const importance = computed(() => mainTask.value?.importance ?? subtaskDetail.value?.task.importance ?? "mid");
const dueDate = computed(() => mainTask.value?.dueDate ?? subtaskDetail.value?.task.dueDate ?? null);
const progress = computed(() => mainTask.value?.progress ?? subtaskDetail.value?.task.progress ?? 0);
/** 完整进展详情：小任务形态取父任务的完整文本（小任务自身没有 detail 字段）。 */
const detailText = computed(() => mainTask.value?.detail ?? subtaskDetail.value?.parent.detail ?? "");
const subtasks = computed(() => mainTask.value?.subtasks ?? subtaskDetail.value?.parent.subtasks ?? []);
const doneCount = computed(() => subtasks.value.filter((subtask) => subtask.progress >= 100).length);
const roleLabel = computed(() => (detail.value?.memberRole === "owner" ? "负责人" : "协作"));
</script>

<template>
  <BaseDialog :open="open" title="任务详情（只读）" @close="emit('close')">
    <LoadingState v-if="detailQuery.isLoading.value" label="任务详情加载中…" />
    <ErrorState
      v-else-if="detailQuery.isError.value"
      message="任务详情加载失败"
      retryable
      @retry="detailQuery.refetch()"
    />
    <template v-else-if="detail">
      <p class="ro-note">成员视图为只读；仅展示你有权查看的任务信息。</p>

      <dl class="fields">
        <div class="field">
          <dt>任务描述</dt>
          <dd>{{ description }}</dd>
        </div>
        <div v-if="parentDescription" class="field">
          <dt>所属主任务</dt>
          <dd>{{ parentDescription }}</dd>
        </div>
        <div class="field">
          <dt>负责人</dt>
          <dd>{{ ownerNames }}</dd>
        </div>
        <div class="field">
          <dt>协作</dt>
          <dd>{{ collaboratorNames || "无" }}</dd>
        </div>
        <div class="field">
          <dt>重要度</dt>
          <dd><ImportanceMark :importance="importance" /></dd>
        </div>
        <div class="field">
          <dt>预计完成</dt>
          <dd>{{ dueDate ?? "未设置" }}</dd>
        </div>
        <div class="field">
          <dt>进度</dt>
          <dd class="progress-row">
            <span class="track"><span class="fill" :class="{ done: progress >= 100 }" :style="{ width: `${progress}%` }" /></span>
            <strong class="percent">{{ progress }}%</strong>
          </dd>
        </div>
        <div class="field">
          <dt>你在本任务中的角色</dt>
          <dd>{{ roleLabel }}</dd>
        </div>
      </dl>

      <section class="pane" aria-label="任务进展详情">
        <div class="pane-title">
          <span>进展详情</span>
          <span class="count">{{ detailText ? detailText.split("\n").filter((line) => line.length > 0).length : 0 }} 条记录</span>
        </div>
        <div v-if="detailText" class="progress-detail">{{ detailText }}</div>
        <p v-else class="empty">暂无进展详情</p>
      </section>

      <section class="pane" aria-label="小任务摘要">
        <div class="pane-title">
          <span>小任务摘要</span>
          <span class="count">{{ doneCount }}/{{ subtasks.length }} 已完成</span>
        </div>
        <ul v-if="subtasks.length" class="subtask-lines">
          <li v-for="subtask in subtasks" :key="subtask.id" class="subtask-line" :class="{ done: subtask.progress >= 100 }">
            <ProgressRing :value="subtask.progress" :label="subtask.description" />
            <span class="subtask-copy">
              <span class="subtask-name">{{ subtask.description }}</span>
              <span class="subtask-owner">负责人 · {{ subtask.owner?.name ?? "待分配" }}</span>
            </span>
            <span class="subtask-percent">{{ subtask.progress }}%</span>
          </li>
        </ul>
        <p v-else class="empty">暂无小任务</p>
      </section>
    </template>
  </BaseDialog>
</template>

<style scoped>
.ro-note {
  font-size: 11.5px;
  color: var(--text-faint);
  border: 1px dashed var(--border-strong);
  border-radius: 7px;
  padding: 6px 10px;
  margin-bottom: 12px;
}

.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 18px;
  margin: 0 0 14px;
}

.field {
  display: flex;
  gap: 8px;
  min-width: 0;
  font-size: 12px;
}

.field dt {
  flex: none;
  width: 96px;
  color: var(--text-faint);
}

.field dd {
  margin: 0;
  color: var(--text-dim);
  min-width: 0;
  word-break: break-word;
}

.progress-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.track {
  flex: 1;
  min-width: 80px;
  height: 6px;
  border-radius: 999px;
  background: var(--bg-inset);
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--blue);
}

.fill.done {
  background: var(--green);
}

.percent {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text);
}

.pane {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-panel);
}

.pane + .pane {
  margin-top: 10px;
}

.pane-title {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 6px;
}

.progress-detail {
  font-size: 12px;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}

.subtask-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.subtask-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.subtask-line.done .subtask-name {
  color: var(--text-faint);
  text-decoration: line-through;
}

.subtask-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.subtask-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subtask-owner {
  font-size: 10.5px;
  color: var(--text-faint);
}

.subtask-percent {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
}

.empty {
  font-size: 11.5px;
  color: var(--text-faint);
  margin: 0;
}
</style>
