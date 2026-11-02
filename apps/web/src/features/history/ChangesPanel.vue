<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { TaskChange } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import ProgressDiff from "./ProgressDiff.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import { buildDiffColumns, type DiffColumns } from "./diff-lines";

/**
 * 时间段历史变化（05 §5.3/§6.14、08 §4.2–4.3，原型 636–660 / 1465–1560）：
 * 默认「昨天至今」，可改自定义日期；列出起止快照的进度/详情变化，
 * 行内展开双列 diff；currentlyDeleted 显示徽章并固定置底。
 * 行形态对齐原型 1538–1546：行首重要度色点 + 负责人头像组 + 徽章 + 进度变化 + 行级增删（D15）。
 */
const props = defineProps<{
  access: "admin" | "share";
  folderId: string | null;
  /** 与看板成员筛选联动（08 §4.1：切换筛选后 changes 一起刷新）。 */
  memberIds: string[];
}>();

/** 已提交的查询（点击「查询」/「昨天至今」才更新，输入过程中不发请求）。 */
const submitted = ref<{ mode: "default" | "custom"; startDate?: string; endDate?: string }>({ mode: "default" });
/** 日期控件草稿；默认区间回填「昨天→今天」，与原型 setDefaultRange（1475–1480 行）一致（R2-D2）。 */
const initialDraft = defaultRangeDraft();
const startInput = ref(initialDraft.start);
const endInput = ref(initialDraft.end);
/**
 * 控件态（原型 rangeMode，1470–1473/1563–1567）：任一日期输入即切 custom——
 * chip 失活、「更新至现在」隐藏占位、边界说明切自定义口径，不必等「查询」提交（R4-D2）。
 * 与 submitted 分开：提交态决定结果区数据与状态行文案，输入期不重查（原型同样只发改控件态）。
 */
const rangeMode = ref<"default" | "custom">("default");
/** 非法区间：提示落在结果区（原型 1490–1492），不再用控件区红字（R4-D8）。 */
const rangeInvalid = ref(false);
/** 折叠的任务集合；默认全部展开（原型默认展开）。 */
const collapsed = ref<Set<string>>(new Set());

const changesQuery = useQuery({
  queryKey: computed(() => [
    "dashboard",
    "changes",
    props.access,
    props.folderId,
    props.memberIds.join(","),
    submitted.value.mode,
    submitted.value.startDate ?? "",
    submitted.value.endDate ?? "",
  ]),
  queryFn: () =>
    props.access === "admin"
      ? adminApi.dashboardChanges({
          folderId: props.folderId!,
          memberIds: props.memberIds,
          mode: submitted.value.mode,
          startDate: submitted.value.startDate,
          endDate: submitted.value.endDate,
        })
      : shareApi.dashboardChanges({
          folderId: props.folderId!,
          memberIds: props.memberIds,
          mode: submitted.value.mode,
          startDate: submitted.value.startDate,
          endDate: submitted.value.endDate,
        }),
  enabled: computed(() => props.folderId !== null),
  // 与看板 summary 同步刷新；后台 tab 暂停。
  refetchInterval: () => (document.visibilityState === "hidden" ? false : 15_000),
  refetchOnWindowFocus: true,
});

const items = computed<TaskChange[]>(() => changesQuery.data.value?.items ?? []);
/** 单条详情超过该字符数就不再计算 diff，避免主线程被超长文本无界阻塞（08 §4.3）。 */
const MAX_DIFF_CHARS = 50_000;
/**
 * 每个任务只计算一次 diff（数据变化时重算），行统计与展开态共用同一结果，
 * 避免每次渲染重复跑 2–3 次全量 diff。
 */
const diffCache = computed(() => {
  const cache = new Map<string, DiffColumns | null>();
  for (const item of items.value) {
    const before = item.before?.detail ?? "";
    if (before.length > MAX_DIFF_CHARS || item.after.detail.length > MAX_DIFF_CHARS) {
      cache.set(item.taskId, null);
      continue;
    }
    cache.set(item.taskId, buildDiffColumns(before, item.after.detail));
  }
  return cache;
});
const timeZone = computed(() => changesQuery.data.value?.timeZone ?? "UTC");

watch(items, () => {
  // 查询结果变化后保留用户已有的折叠选择，只丢弃已不在结果里的 id。
  const ids = new Set(items.value.map((item) => item.taskId));
  collapsed.value = new Set([...collapsed.value].filter((id) => ids.has(id)));
});

/** 默认「昨天至今」：回填默认区间日期并重新按服务器 now 查询（原型 setDefaultRange）。 */
function useDefaultRange(): void {
  rangeInvalid.value = false;
  rangeMode.value = "default";
  const draft = defaultRangeDraft();
  startInput.value = draft.start;
  endInput.value = draft.end;
  submitted.value = { mode: "default" };
}

/** 更新至现在：保持 default 模式重新查询（不是把旧时间戳 +1）；原型 1563 行点击即 setDefaultRange。 */
function refreshToNow(): void {
  const alreadyDefault = submitted.value.mode === "default";
  useDefaultRange();
  // 已提交默认区间时 query key 不变，需显式重取（否则只吃缓存）；刚从自定义回切时由新 key 自动查询。
  if (alreadyDefault) void changesQuery.refetch();
}

/** 日期输入：原型 1564–1567 的 input 处理——只切控件态为 custom 并同步控件，不触发查询。 */
function onRangeInput(): void {
  rangeMode.value = "custom";
}

/**
 * 查询：控件态为 default 时按默认区间查（原型 renderRangeQuery 用 rangeMode 决定解析口径），
 * 否则按草稿日期提交；空值或起止倒置一律落原型 1491 行的整句提示到结果区。
 */
function queryCustom(): void {
  if (rangeMode.value === "default") {
    rangeInvalid.value = false;
    submitted.value = { mode: "default" };
    void changesQuery.refetch();
    return;
  }
  const start = startInput.value;
  const end = endInput.value;
  if (start === "" || end === "" || start > end) {
    rangeInvalid.value = true;
    return;
  }
  rangeInvalid.value = false;
  submitted.value = { mode: "custom", startDate: start, endDate: end };
}

/** 本地日期串（YYYY-MM-DD），与 input[type="date"] 的取值格式一致。 */
function formatLocalInput(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 默认区间（昨天→今天）的日期输入回填值。 */
function defaultRangeDraft(): { start: string; end: string } {
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return { start: formatLocalInput(yesterday), end: formatLocalInput(now) };
}

/**
 * 把 UTC 边界按 manifest 时区格式化；diff 快照标签用分钟精度（原型 1536–1537 slice(0,16)），
 * 状态行时间戳带秒（原型 1494–1495 formatTimestamp，R2-D2）。
 */
function formatInTimeZone(iso: string, withSeconds: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone.value,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).formatToParts(date);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const base = `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
  return withSeconds ? `${base}:${value("second")}` : base;
}

function formatBoundary(iso: string): string {
  return formatInTimeZone(iso, false);
}

/** 状态行时间戳：`YYYY-MM-DD HH:mm:ss`。 */
function formatStamp(iso: string): string {
  return formatInTimeZone(iso, true);
}

function isOpen(taskId: string): boolean {
  return !collapsed.value.has(taskId);
}

function toggleRow(taskId: string): void {
  const next = new Set(collapsed.value);
  if (next.has(taskId)) next.delete(taskId);
  else next.add(taskId);
  collapsed.value = next;
}

function expandAll(): void {
  collapsed.value = new Set();
}

function collapseAll(): void {
  collapsed.value = new Set(items.value.map((item) => item.taskId));
}

function progressDelta(item: TaskChange): number {
  return item.before ? item.after.progress - item.before.progress : item.after.progress;
}

function progressText(item: TaskChange): string {
  const delta = progressDelta(item);
  const sign = delta > 0 ? "▲" : delta < 0 ? "▼" : "•";
  return `${item.before ? `${item.before.progress}% → ` : "新建 → "}${item.after.progress}% ${sign}`;
}

function progressTone(item: TaskChange): "up" | "down" | "flat" {
  const delta = progressDelta(item);
  return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
}

/** 行级增删统计：复用缓存结果；超长文本返回 0/0。 */
function lineStats(item: TaskChange): { added: number; removed: number } {
  const columns = diffCache.value.get(item.taskId);
  return columns ? { added: columns.added, removed: columns.removed } : { added: 0, removed: 0 };
}

/** 展开态的双列数据；null 表示文本过长已跳过。 */
function columnsOf(item: TaskChange): DiffColumns | null {
  return diffCache.value.get(item.taskId) ?? null;
}

function beforeLabel(item: TaskChange): string {
  if (item.before === null) return "起始时不存在";
  return `起始快照 · ${formatBoundary(item.before.recordedAt)}（进度 ${item.before.progress}%）`;
}

function afterLabel(item: TaskChange): string {
  return `结束快照 · ${formatBoundary(item.after.recordedAt)}（进度 ${item.after.progress}%）`;
}
</script>

<template>
  <section class="range-panel" aria-label="任务进展变化">
    <div class="range-head">
      <div>
        <h3>任务进展变化</h3>
        <p>对比起止时刻的任务进度与进展详情</p>
      </div>
      <!-- 原型 305–307：胶囊 chip（独立样式，非复用 .btn），前置状态圆点；激活跟随控件态（R4-D2）。 -->
      <button type="button" class="range-preset" :class="{ active: rangeMode === 'default' }" @click="useDefaultRange">
        昨天至今
      </button>
    </div>

    <div class="range-controls">
      <label class="range-field">
        <span>开始日期</span>
        <input v-model="startInput" type="date" aria-label="历史开始日期" @input="onRangeInput">
      </label>
      <span class="arrow" aria-hidden="true">→</span>
      <label class="range-field">
        <span>结束日期</span>
        <input v-model="endInput" type="date" aria-label="历史结束日期" @input="onRangeInput">
      </label>
      <button type="button" class="btn primary" @click="queryCustom">查询</button>
      <!-- 原型 1470 行：文案恒为「↻ 更新至现在」，非默认区间用 visibility: hidden 保留布局占位。 -->
      <button type="button" class="btn ghost range-now" :class="{ 'is-hidden': rangeMode !== 'default' }" @click="refreshToNow">
        ↻ 更新至现在
      </button>
      <!-- 原型 316–317 + 1472–1473：边界说明在控件条带内独占一行（前置 ⓘ 圈），文案带秒位；随控件态切换。 -->
      <p class="range-boundary">
        {{ rangeMode === "default"
          ? "默认查询昨天 00:00:00 至当前时刻；结束时间不会延伸到今天 23:59:59"
          : "自定义日期：开始于 00:00:00，结束于 23:59:59，包含起止两天" }}
      </p>
    </div>

    <div class="range-result">
      <!-- 原型 1490–1492：非法区间整块替换结果区（含旧结果），文案整句、左对齐 12px。 -->
      <p v-if="rangeInvalid" class="range-empty">请选择有效的起止日期，开始日期不能晚于结束日期。</p>
      <LoadingState v-else-if="changesQuery.isLoading.value" label="历史变化加载中…" />
      <ErrorState
        v-else-if="changesQuery.isError.value && changesQuery.data.value === undefined"
        message="历史变化加载失败"
        retryable
        @retry="changesQuery.refetch()"
      />
      <template v-else>
        <p v-if="changesQuery.isError.value" class="stale-banner" role="status">刷新失败，显示上一次结果。</p>
        <div class="range-status">
          <span class="status-dot" aria-hidden="true" />
          <span class="status-label" aria-live="polite">{{ submitted.mode === "default" ? "已自动查询 · 昨天至今" : "已查询 · 自定义日期" }}</span>
          <time v-if="changesQuery.data.value">
            {{ formatStamp(changesQuery.data.value.start) }} → {{ formatStamp(changesQuery.data.value.end) }}
          </time>
        </div>

        <div v-if="items.length === 0" class="range-empty">该时间段内所选范围的任务没有进展变化。</div>

        <template v-else>
          <div class="chg-toolbar">
            <div class="chg-summary">共 <b>{{ items.length }}</b> 个任务有进展变化，点击任务行可单独展开 / 折叠：</div>
            <div class="chg-actions">
              <button type="button" class="btn ghost chg-action" @click="expandAll">全部展开</button>
              <button type="button" class="btn ghost chg-action" @click="collapseAll">全部折叠</button>
            </div>
          </div>

          <div class="chg-list">
            <div v-for="item in items" :key="item.taskId" class="chg-item">
              <button
                type="button"
                class="chg-row"
                :class="{ open: isOpen(item.taskId), deleted: item.currentlyDeleted }"
                :aria-expanded="isOpen(item.taskId)"
                @click="toggleRow(item.taskId)"
              >
                <!-- 原型 1539：行首重要度色点。 -->
                <span class="imp-dot" :class="item.importance === undefined ? 'mid' : item.importance" aria-hidden="true" />
                <span class="desc">{{ item.description }}</span>
                <span v-if="item.changeKind === 'created'" class="created-badge">区间内创建</span>
                <span v-if="item.currentlyDeleted" class="deleted-badge">当前已删除</span>
                <!-- 原型 1543：负责人头像组（-6px 叠放 + 白描边）。 -->
                <span class="chg-owners">
                  <span v-for="owner in item.owners" :key="owner.id" class="ava" :style="{ background: owner.color }" :title="`${owner.name} · ${owner.role}`">{{ owner.name.slice(0, 1) }}</span>
                </span>
                <span class="pchg" :class="progressTone(item)">{{ progressText(item) }}</span>
                <span class="dstat">
                  <span class="a">+{{ lineStats(item).added }}</span>
                  <span class="d">−{{ lineStats(item).removed }}</span>
                </span>
                <span class="chev" aria-hidden="true">▶</span>
              </button>
              <ProgressDiff
                v-if="isOpen(item.taskId)"
                :before="item.before?.detail ?? null"
                :after="item.after.detail"
                :before-label="beforeLabel(item)"
                :after-label="afterLabel(item)"
                :columns="columnsOf(item)"
              />
            </div>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* 原型 300：整卡无内距、overflow hidden；内距由头部/条带/结果各自承担，控件条带才能通栏。
 * margin-top 16 与原型 302 行同值（R4-D4 纵向节奏）。 */
.range-panel {
  margin-top: 16px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* 原型 301：头部 15/18/13 内距，chip 垂直居中。 */
.range-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 18px 13px;
}

/* 原型 302：range-head 标题 13px/650。 */
.range-head h3 {
  font-size: 13px;
  font-weight: 650;
}

.range-head p {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-faint);
}

/* 原型 193 + 314：控件区按钮吃全局 .btn（12.5px/600/6px 14px/r8）+ 条带内最低 31px（R4-D3）。 */
.btn {
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
}

.range-controls .btn {
  min-height: 31px;
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

/* 原型 305：胶囊 chip —— 999 圆角、1px --border 描边、4/11 内距、11.5px/600、前置状态点。
 * 不复用 .btn（原型里它也不是 .btn），否则会被 12px/400/圆角矩形/无描边带偏（R3-D3·1）。 */
.range-preset {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  font: inherit;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 11px;
  cursor: pointer;
}

.range-preset::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
  flex: none;
}

/* 原型 306：激活 chip 蓝字、边框蓝 35%、底 7%；状态点转蓝并带 12% 光环（原型 307）。 */
.range-preset.active {
  color: var(--blue);
  border-color: color-mix(in srgb, var(--blue) 35%, transparent);
  background: color-mix(in srgb, var(--blue) 7%, transparent);
}

.range-preset.active::before {
  background: var(--blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 12%, transparent);
}

/* 原型 308：控件条带通栏 #fafbfc 底 + 上下 1px #eef1f5 边 + 13/18/11 内距（R3-D3·2）。 */
.range-controls {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  padding: 13px 18px 11px;
  background: var(--bg-panel);
  border-top: 1px solid var(--border-row);
  border-bottom: 1px solid var(--border-row);
}

.range-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 原型 310：字段标签 10.5px/600/--text-faint。 */
.range-field > span {
  font-size: 10.5px;
  color: var(--text-faint);
  font-weight: 600;
}

/* 原型 311–312：白底 + 强描边 #c9cfd8 + radius 8 + 5/9 内距 + mono 12px；聚焦蓝描边 + 10% 光环（R3-D3·3）。 */
.range-field input {
  font: inherit;
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 5px 9px;
  outline: none;
}

.range-field input:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 10%, transparent);
}

.arrow {
  color: var(--text-faint);
  padding-bottom: 7px;
}

/* 原型 1470 行：非默认区间只隐藏可见性、保留 104px 布局占位（宽度随「↻ 更新至现在」恒定）。 */
.range-now {
  white-space: nowrap;
}

.range-now.is-hidden {
  visibility: hidden;
}

.range-boundary {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--text-faint);
  padding-top: 1px;
}

/* 原型 317：边界说明前置「i」圈图标。 */
.range-boundary::before {
  content: "i";
  display: inline-grid;
  place-items: center;
  width: 13px;
  height: 13px;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  font-family: var(--mono);
  font-size: 9px;
  flex: none;
}

/* 原型 318：结果区内距 13/18/16（R3-D3·2 条带之外的配套）。 */
.range-result {
  padding: 13px 18px 16px;
}

/* 原型 319：状态行 11px/--text-dim、7px 间距、下外边距 10；无分隔线、无竖向内距（R3-D3·4）。 */
.range-status {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--text-dim);
}

/* 原型 319–320：状态点 6px + 绿色 10% 光环。 */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--green) 10%, transparent);
  flex: none;
}

/* 原型 321：状态行标签 600 + --text（此前继承 400/--text-dim，R4-D3）。 */
.range-status .status-label {
  font-weight: 600;
  color: var(--text);
}

/* 原型 321：时间戳 mono 10.5px/--text-faint 靠右。 */
.range-status time {
  margin-left: auto;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-faint);
}

/* 原型 323：区间空态 12px、左对齐、10/0/2 内距（R3-D3·6）。 */
.range-empty {
  padding: 10px 0 2px;
  font-size: 12px;
  color: var(--text-faint);
}

/* 原型 327：工具条仅下外边距 8（内距已由 .range-result 承担）。 */
.chg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

/* 原型 328：汇总 12px。 */
.chg-summary {
  font-size: 12px;
  color: var(--text-dim);
}

.chg-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* 原型 329：展开/折叠按钮 11px / 3px 9px / radius 8（R3-D3·5）。 */
.chg-action {
  min-height: 0;
  padding: 3px 9px;
  font-size: 11px;
  border-radius: 8px;
  white-space: nowrap;
}

/* 原型 330：变化列表是圆角描边盒。 */
.chg-list {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}

/* 原型 331：行分隔 #eef1f5；末行无线。 */
.chg-item {
  border-bottom: 1px solid var(--border-row);
}

.chg-item:last-child {
  border-bottom: none;
}

/* 原型 331–332：行 9/14 内距、白底、hover #f7f9fc。 */
.chg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 14px;
  font: inherit;
  text-align: left;
  background: var(--bg-card);
  border: none;
  cursor: pointer;
  color: var(--text);
  flex-wrap: wrap;
}

.chg-row:hover {
  background: #f7f9fc;
}

.chg-row.deleted {
  background: var(--bg-panel);
}

.chg-row.deleted .desc {
  color: var(--text-dim);
  text-decoration: line-through;
  text-decoration-color: var(--text-faint);
}

.chg-row .desc {
  font-size: 12.5px;
  font-weight: 550;
  flex: 1;
  min-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 原型 1539：行首重要度色点。 */
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
  background: var(--imp-low);
}

/* 原型 79–80：负责人头像组，18px、-6px 叠放、2px 白描边。 */
.chg-owners {
  display: inline-flex;
  flex: none;
}

.chg-owners .ava {
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

.chg-owners .ava + .ava {
  margin-left: -6px;
  box-shadow: 0 0 0 2px #fff;
}

/* 原型 334：进度变化 mono 11.5px/600（字重此前漏掉，R3-D3·5）。 */
.pchg {
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 600;
  white-space: nowrap;
}

.pchg.up {
  color: var(--green);
}

.pchg.down {
  color: var(--red);
}

.pchg.flat {
  color: var(--text-faint);
}

.stale-banner {
  margin: 6px 0;
  font-size: 11px;
  color: var(--orange);
}

/* 原型 335–336：行尾 +N/−N mono 10.5px。 */
.dstat {
  display: inline-flex;
  gap: 6px;
  font-family: var(--mono);
  font-size: 10.5px;
}

.dstat .a {
  color: var(--green);
}

.dstat .d {
  color: var(--red);
}

/* 原型 342–343：徽章 10px/600、圆角 5；created 蓝字浅蓝底、deleted 灰字浅灰描边。 */
.created-badge,
.deleted-badge {
  font-size: 10px;
  font-weight: 600;
  border-radius: 5px;
  padding: 1px 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.created-badge {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
}

/* R3-D4（原型 342）：徽章三值 #6e7787 / #eef1f5 / #dce1e8——此前描边用了与底色同值的
 * --border-row，导致描边不可见。 */
.deleted-badge {
  color: var(--low-strong);
  background: var(--badge-bg);
  border: 1px solid var(--badge-border);
}

/* 原型 337：行尾 ▶ 10px。 */
.chev {
  font-size: 10px;
  color: var(--text-faint);
  transition: transform 0.12s;
}

.chg-row.open .chev {
  transform: rotate(90deg);
}

@media (max-width: 900px) {
  .range-status {
    flex-wrap: wrap;
  }

  .range-status time {
    margin-left: 0;
  }
}
</style>
