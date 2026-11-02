<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskCardModel } from "./task-card-model";
import { doneSubtaskCount, isOverdue } from "./task-card-model";
import ImportanceMark from "./ui/ImportanceMark.vue";
import PaneResizer from "./ui/PaneResizer.vue";
import ProgressRing from "./ui/ProgressRing.vue";

/**
 * 统一只读任务卡（原型 taskRow 的组件化，03 §5/§7.3）：
 * 头部"标题/属性 + 总进度"，主体"小任务进展 / 进展详情"双栏（可调宽度）。
 * 永远不渲染编辑控件；头部 Enter/Space 触发 open（路由深链由父级处理）。
 */
const props = defineProps<{ task: TaskCardModel }>();

const emit = defineEmits<{ open: [taskId: string] }>();

const subtaskPanePercent = ref(36);
const overdue = computed(() => isOverdue(props.task));
const doneCount = computed(() => doneSubtaskCount(props.task.subtasks));
const detailLines = computed(() => props.task.detail.split("\n").filter((line) => line.length > 0).length);

function onHeaderKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    emit("open", props.task.id);
  }
}
</script>

<template>
  <article class="task-card" :data-task-card="task.id">
    <header
      class="card-head"
      tabindex="0"
      title="打开任务详情浮窗"
      :aria-label="`打开任务详情：${task.description}`"
      @click="emit('open', task.id)"
      @keydown="onHeaderKeydown"
    >
      <div class="identity">
        <div class="title-line">
          <ImportanceMark :importance="task.importance" dot-only />
          <span class="title">{{ task.description }}</span>
          <span v-if="task.folderName" class="folder">{{ task.folderName }}</span>
        </div>
        <div class="facts">
          <span>{{ task.owners.join("、") || "待分配" }}</span>
          <ImportanceMark :importance="task.importance" />
          <span class="due" :class="{ overdue }">
            预计 {{ task.dueDate ?? "未设置" }}<template v-if="overdue"> · 已逾期</template>
          </span>
        </div>
      </div>
      <div class="total">
        <div class="total-label"><span>任务总进度</span><strong>{{ task.progress }}%</strong></div>
        <span class="track"><span class="fill" :class="{ done: task.progress >= 100 }" :style="{ width: `${task.progress}%` }" /></span>
      </div>
    </header>

    <div class="card-body" :style="{ '--subtask-pane-width': `${subtaskPanePercent}%` }">
      <section class="pane" aria-label="子任务进展">
        <div class="pane-title">
          <span>子任务进展</span>
          <span class="count">{{ doneCount }}/{{ task.subtasks.length }} 已完成</span>
        </div>
        <div v-if="task.subtasks.length" class="subtask-lines">
          <div v-for="subtask in task.subtasks" :key="subtask.id" class="subtask-line" :class="{ done: subtask.progress >= 100 }">
            <ProgressRing :value="subtask.progress" :label="subtask.description" />
            <span class="subtask-copy">
              <span class="subtask-name" :title="subtask.description">{{ subtask.description }}</span>
              <span class="subtask-owner">负责人 · {{ subtask.ownerName ?? "待分配" }}</span>
            </span>
          </div>
        </div>
        <div v-else class="empty">暂无小任务</div>
      </section>

      <PaneResizer
        v-model="subtaskPanePercent"
        label="调整子任务与任务详情宽度"
        :min="26"
        :max="55"
      />

      <section class="pane" aria-label="任务进展详情">
        <div class="pane-title">
          <span>进展详情</span>
          <span class="count">{{ detailLines }} 条记录</span>
        </div>
        <div v-if="task.detail" class="progress-detail">{{ task.detail }}</div>
        <div v-else class="empty">暂无进展详情</div>
      </section>
    </div>
  </article>
</template>

<style scoped>
.task-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 14px;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--border);
}

.card-head:hover,
.card-head:focus-visible {
  background: var(--bg-panel);
}

.card-head:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}

.identity {
  min-width: 0;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 7px;
}

.title {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder {
  font-size: 10.5px;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 7px;
  flex: none;
}

.facts {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 3px;
  font-size: 11px;
  color: var(--text-dim);
}

.due.overdue {
  color: var(--red);
}

.total {
  flex: none;
  width: 180px;
}

.total-label {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--text-faint);
  margin-bottom: 3px;
}

.total-label strong {
  color: var(--text);
  font-family: var(--mono);
}

.track {
  display: block;
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

.card-body {
  display: grid;
  grid-template-columns: var(--subtask-pane-width, 36%) auto 1fr;
  min-height: 84px;
}

.pane {
  padding: 10px 14px;
  min-width: 0;
}

.pane-title {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 6px;
}

.subtask-lines {
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

.progress-detail {
  font-size: 12px;
  color: var(--text-dim);
  white-space: pre-wrap;
  word-break: break-word;
}

.empty {
  font-size: 11.5px;
  color: var(--text-faint);
  padding: 8px 0;
}

@media (max-width: 900px) {
  .card-body {
    grid-template-columns: 1fr;
  }

  .card-body :deep(.resizer) {
    display: none;
  }

  .total {
    width: 120px;
  }
}
</style>
