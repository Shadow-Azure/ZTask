<script setup lang="ts">
import { computed, ref } from "vue";
import type { TaskCardModel } from "./task-card-model";
import { doneSubtaskCount, formatDueShort, isOverdue } from "./task-card-model";
import ImportanceMark from "./ui/ImportanceMark.vue";
import PaneResizer from "./ui/PaneResizer.vue";
import ProgressRing from "./ui/ProgressRing.vue";

/**
 * 统一只读任务卡（原型 taskRow 的组件化，03 §5/§7.3）：
 * 头部"标题/属性 + 总进度"，主体"小任务进展 / 进展详情"双栏（可调宽度）。
 * 视觉对齐原型 206–256：卡头双列 grid（minmax(0,1fr) / minmax(220px,300px)）、
 * 14px/650 标题、facts 首项为 17px 成员头像组、facts 重要度为 tinted chip（R2-D1）、
 * 「预计 M-D」行内红字「· 已逾期」无徽章（D4/D5/D6；徽章形态只属于成员端卡）。
 * 永远不渲染编辑控件；头部 Enter/Space 触发 open（路由深链由父级处理）。
 */
const props = defineProps<{ task: TaskCardModel }>();

const emit = defineEmits<{ open: [taskId: string] }>();

const subtaskPanePercent = ref(36);
/** 卡体元素：指针拖拽时用它的 content box 宽度换算子任务栏百分比。 */
const bodyEl = ref<HTMLElement | null>(null);
const overdue = computed(() => isOverdue(props.task));
const doneCount = computed(() => doneSubtaskCount(props.task.subtasks));
const detailLines = computed(() => props.task.detail.split("\n").filter((line) => line.length > 0).length);
const dueShort = computed(() => formatDueShort(props.task.dueDate));
const ownerNames = computed(() => props.task.owners.map((owner) => owner.name).join("、"));

/** 卡内拖柄指针拖拽：clientX → 卡体宽度百分比（同原型 bindTaskRows 的 resize 口径，26–55% 夹取）。 */
function onPaneDrag(clientX: number): void {
  const rect = bodyEl.value?.getBoundingClientRect();
  if (!rect || rect.width === 0) return;
  const percent = ((clientX - rect.left) / rect.width) * 100;
  subtaskPanePercent.value = Math.min(55, Math.max(26, Math.round(percent * 10) / 10));
}

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
          <span class="fact-owners">
            <span v-if="task.owners.length" class="ava-group">
              <span
                v-for="owner in task.owners"
                :key="owner.id"
                class="ava"
                :style="{ background: owner.color }"
                :title="`${owner.name} · ${owner.role}`"
              >{{ owner.name.slice(0, 1) }}</span>
            </span>
            <span>{{ ownerNames || "待分配" }}</span>
          </span>
          <ImportanceMark :importance="task.importance" chip />
          <!-- 原型 1248：逾期为行内红字「预计 M-D · 已逾期」，无独立徽章（D6 回归修正）。 -->
          <span class="due" :class="{ overdue }">预计 {{ dueShort ?? "未设置" }}{{ overdue ? " · 已逾期" : "" }}</span>
        </div>
      </div>
      <div class="total">
        <div class="total-label"><span>任务总进度</span><strong>{{ task.progress }}%</strong></div>
        <span class="track"><span class="fill" :class="{ done: task.progress >= 100 }" :style="{ width: `${task.progress}%` }" /></span>
      </div>
    </header>

    <div ref="bodyEl" class="card-body" :style="{ '--subtask-pane-width': `${subtaskPanePercent}%` }">
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
              <span class="subtask-owner">
                <span
                  v-if="subtask.ownerColor"
                  class="ava sm"
                  :style="{ background: subtask.ownerColor }"
                  aria-hidden="true"
                >{{ (subtask.ownerName ?? "？").slice(0, 1) }}</span>
                <span>负责人 · {{ subtask.ownerName ?? "待分配" }}</span>
              </span>
            </span>
          </div>
        </div>
        <div v-else class="empty">暂无小任务</div>
      </section>

      <PaneResizer
        v-model="subtaskPanePercent"
        variant="pane"
        label="调整子任务与任务详情宽度"
        :min="26"
        :max="55"
        @drag="onPaneDrag"
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
/* 原型 206：radius 12 + 更轻的投影。 */
.task-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  overflow: hidden;
}

/* 原型 207–209：双列 grid + 24 gap；头部无下边框（分隔交给卡体上边框）。 */
.card-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 300px);
  align-items: center;
  gap: 24px;
  padding: 16px 20px 15px;
  cursor: pointer;
}

.card-head:hover {
  background: #fafbfc;
}

.card-head:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--blue) 50%, transparent);
}

.identity {
  min-width: 0;
}

.title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

/* 原型 212：14px/650、-0.1px 字距、单行省略。 */
.title {
  font-weight: 650;
  font-size: 14px;
  letter-spacing: -0.1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 原型 213：来源夹是 10.5px 无边框弱化文本。 */
.folder {
  flex: none;
  color: var(--text-faint);
  font-size: 10.5px;
  font-weight: 400;
}

/* 原型 214–217：facts 11px faint、12px 间距、margin-top 6px。 */
.facts {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-faint);
}

.fact-owners {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

/* 原型 79–80/216：17px 圆头像、-6px 叠放、2px 白描边。 */
.ava-group {
  display: inline-flex;
  flex: none;
}

.ava {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-size: 9px;
  font-weight: 600;
  flex: none;
}

.ava-group .ava + .ava {
  margin-left: -6px;
  box-shadow: 0 0 0 2px #fff;
}

/* 原型 95–96/1248：mono 11.5px；逾期整段红字 600（行内「· 已逾期」，无徽章）。 */
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

/* 原型 218–223：总进度列 220–300px、mono 15px 数值、5px track。 */
.total {
  min-width: 0;
}

.total-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 7px;
  color: var(--text-dim);
  font-size: 10.5px;
}

.total-label strong {
  color: var(--text);
  font-family: var(--mono);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.track {
  display: block;
  width: 100%;
  height: 5px;
  border-radius: 3px;
  background: #e8ebf0;
  overflow: hidden;
}

.fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--blue);
}

.fill.done {
  background: var(--green);
}

/* 原型 224/231：卡体上边框分隔、pane 15/20/17 内距；中缝列 = 原型 13px 拖柄槽（R4-D5）。 */
.card-body {
  display: grid;
  grid-template-columns: var(--subtask-pane-width, 36%) var(--resizer-pane) minmax(0, 1fr);
  border-top: 1px solid var(--border-soft);
  min-height: 84px;
}

.pane {
  padding: 15px 20px 17px;
  min-width: 0;
}

/* 原型 232–233：11px/650 dim 标题 + 右侧 mono 计数。 */
.pane-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 650;
  margin-bottom: 11px;
}

.pane-title .count {
  margin-left: auto;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 500;
}

.subtask-lines {
  display: grid;
  gap: 12px;
}

/* 原型 235：38px 环列 + 1fr 文案列。 */
.subtask-line {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 38px;
}

.subtask-line.done .subtask-name {
  color: var(--text-faint);
}

.subtask-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* 原型 244：11.5px dim 描述。 */
.subtask-name {
  font-size: 11.5px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 原型 246–247：16px 头像 + 负责人文本。 */
.subtask-owner {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  color: var(--text-faint);
  font-size: 10px;
  line-height: 1.2;
}

.ava.sm {
  width: 16px;
  height: 16px;
  font-size: 8.5px;
}

/* 原型 248：11.5px/1.8 dim 详情。 */
.progress-detail {
  font-size: 11.5px;
  line-height: 1.8;
  color: var(--text-dim);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.empty {
  font-size: 11px;
  line-height: 1.8;
  color: var(--text-faint);
}

@media (max-width: 1100px) {
  .card-head {
    grid-template-columns: minmax(0, 1fr) 170px;
    gap: 16px;
    padding-left: 16px;
    padding-right: 16px;
  }

  .card-body {
    grid-template-columns: 1fr;
  }

  .card-body :deep(.resizer) {
    display: none;
  }

  .pane + .pane {
    border-top: 1px solid var(--border-soft);
  }
}
</style>
