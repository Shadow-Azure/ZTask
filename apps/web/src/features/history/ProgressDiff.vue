<script setup lang="ts">
import { computed } from "vue";
import { buildDiffColumns, type DiffLine } from "./diff-lines";

/**
 * 双列进展 diff（08 §4.3，原型 344–354 / 1510–1540）：
 * 左列起始快照、右列结束快照；删除行左红右空、新增行左空右绿、未变化两列同文。
 * 全部文本通过 Vue 插值渲染，`<script>` 等内容只会显示为文本，绝不执行。
 */
const props = defineProps<{
  /** 起始快照详情；null 表示区间内创建（不伪造空文本 diff）。 */
  before: string | null;
  /** 结束快照详情。 */
  after: string;
  /** 左列标题（含时间与进度）。 */
  beforeLabel: string;
  /** 右列标题（含时间与进度）。 */
  afterLabel: string;
}>();

const columns = computed(() => buildDiffColumns(props.before ?? "", props.after));

/** 行文本：blank 用不换行空格占位，保持行高（原型 .dl.blank）。 */
function display(line: DiffLine): string {
  return line.kind === "blank" ? "\u00a0" : line.text === "" ? "\u00a0" : line.text;
}

/** 创建场景右列不标绿：不是「新增行」，而是「此前不存在」。 */
function leftKind(line: DiffLine): string {
  return props.before === null ? "blank" : line.kind;
}

function rightKind(line: DiffLine): string {
  return props.before === null ? "same" : line.kind;
}
</script>

<template>
  <div class="diff-wrap">
    <div class="diff-col">
      <h4>{{ beforeLabel }}</h4>
      <pre v-if="before !== null"><span
        v-for="(line, index) in columns.left"
        :key="index"
        class="dl"
        :class="leftKind(line)"
      >{{ display(line) }}</span></pre>
    </div>
    <div class="diff-col">
      <h4>{{ afterLabel }}</h4>
      <pre><span
        v-for="(line, index) in columns.right"
        :key="index"
        class="dl"
        :class="rightKind(line)"
      >{{ display(line) }}</span></pre>
    </div>
  </div>
</template>

<style scoped>
.diff-wrap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.diff-col {
  padding: 10px 14px;
  min-width: 0;
}

.diff-col + .diff-col {
  border-left: 1px dashed var(--border);
}

.diff-col h4 {
  font-size: 11px;
  color: var(--text-faint);
  font-weight: 600;
  margin-bottom: 6px;
  font-family: var(--mono);
}

.diff-col pre {
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.diff-col pre .dl {
  display: block;
  padding: 0 6px;
  border-radius: 4px;
}

.diff-col pre .dl.del {
  background: color-mix(in srgb, var(--red) 10%, transparent);
  color: #a02c2c;
}

.diff-col pre .dl.add {
  background: color-mix(in srgb, var(--green) 11%, transparent);
  color: #146c49;
}

.diff-col pre .dl.same {
  color: var(--text-dim);
}

.diff-col pre .dl.blank {
  visibility: hidden;
}

@media (max-width: 720px) {
  .diff-wrap {
    grid-template-columns: 1fr;
  }

  .diff-col + .diff-col {
    border-left: none;
    border-top: 1px dashed var(--border);
  }
}
</style>
