<script setup lang="ts">
import { computed } from "vue";
import type { Importance, Task } from "@ztask/shared";
import { isOverdue } from "../../components/task-card-model";

/**
 * 成员视图的只读任务卡（原型 1851–1886，08 §6.2）：
 * 展示重要度/描述/任务夹路径、负责人与协作、预计完成、小任务摘要、进度与完整进展详情。
 * 卡片恒为只读——不可聚焦、无 click/open 语义、无任何 input/button；
 * 负责人编辑入口属于后续 issue，本 issue 的个人页不开放写操作。
 */
const props = defineProps<{
  /** 分享域返回的主任务聚合。 */
  task: Task;
  /** 协作任务标记：为 true 时追加「协作任务 · 只读」徽标。 */
  readonly?: boolean;
  /** 由调用方用可见任务夹树算出的路径（如「迭代 / 子夹」），省略时不渲染。 */
  folderPath?: string;
}>();

const IMPORTANCE_NAMES: Record<Importance, string> = { high: "高", mid: "中", low: "低" };

const ownerNames = computed(() => props.task.owners.map((owner) => owner.name).join("、"));
const collaboratorNames = computed(() => props.task.collaborators.map((member) => member.name).join("、"));
const overdue = computed(() => isOverdue({ dueDate: props.task.dueDate, progress: props.task.progress }));
const dueLabel = computed(() => {
  if (props.task.dueDate === null) return "未设置";
  const [, month, day] = props.task.dueDate.split("-");
  return `${Number(month)}-${day}`;
});
const detailText = computed(() => props.task.detail || "（暂无进展记录）");

/**
 * 小任务完成标记：100% 用实心方框，其余空心（原型 .sub-ro 的 ☑/☐ 形状）。
 * @param progress 小任务进度。
 * @returns 是否已完成。
 */
function isDone(progress: number): boolean {
  return progress >= 100;
}
</script>

<template>
  <article class="stask" :class="{ readonly }">
    <div class="r1">
      <span class="imp-dot" :class="task.importance" aria-hidden="true" />
      <span class="desc">{{ task.description }}</span>
      <span v-if="folderPath" class="sub-badge">📁 {{ folderPath }}</span>
      <span class="imp" :class="task.importance">重要度 · {{ IMPORTANCE_NAMES[task.importance] }}</span>
      <span v-if="readonly" class="ro-tag">协作任务 · 只读</span>
    </div>

    <div class="meta">
      <span><span class="k">负责人</span>{{ ownerNames || "—" }}</span>
      <span v-if="collaboratorNames"><span class="k">协作</span>{{ collaboratorNames }}</span>
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
      </li>
    </ul>

    <div class="read-row">
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

.sub-badge {
  flex: none;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-faint);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.sub-ro li .sd {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.sub-ro li.done .sd {
  text-decoration: line-through;
  color: var(--text-faint);
}

.read-row {
  display: grid;
  grid-template-columns: 220px 1fr;
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

@media (max-width: 720px) {
  .read-row {
    grid-template-columns: 1fr;
  }
}
</style>
