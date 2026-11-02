<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { TaskChange } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import ProgressDiff from "./ProgressDiff.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import { buildDiffColumns } from "./diff-lines";

/**
 * 时间段历史变化（05 §5.3/§6.14、08 §4.2–4.3，原型 636–660 / 1465–1560）：
 * 默认「昨天至今」，可改自定义日期；列出起止快照的进度/详情变化，
 * 行内展开双列 diff；currentlyDeleted 显示徽章并固定置底。
 */
const props = defineProps<{
  access: "admin" | "share";
  folderId: string | null;
  /** 与看板成员筛选联动（08 §4.1：切换筛选后 changes 一起刷新）。 */
  memberIds: string[];
}>();

/** 已提交的查询（点击「查询」/「昨天至今」才更新，输入过程中不发请求）。 */
const submitted = ref<{ mode: "default" | "custom"; startDate?: string; endDate?: string }>({ mode: "default" });
/** 日期控件草稿。 */
const startInput = ref("");
const endInput = ref("");
const rangeError = ref("");
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
const timeZone = computed(() => changesQuery.data.value?.timeZone ?? "UTC");

watch(items, () => {
  // 查询结果变化后保留用户已有的折叠选择，只丢弃已不在结果里的 id。
  const ids = new Set(items.value.map((item) => item.taskId));
  collapsed.value = new Set([...collapsed.value].filter((id) => ids.has(id)));
});

/** 默认「昨天至今」：清空自定义输入并重新按服务器 now 查询。 */
function useDefaultRange(): void {
  rangeError.value = "";
  startInput.value = "";
  endInput.value = "";
  submitted.value = { mode: "default" };
}

/** 更新至现在：保持 default 模式重新查询（不是把旧时间戳 +1）。 */
function refreshToNow(): void {
  if (submitted.value.mode === "default") void changesQuery.refetch();
  else useDefaultRange();
}

/** 自定义查询：先做本地日期合法性/顺序校验，再提交。 */
function queryCustom(): void {
  const start = startInput.value;
  const end = endInput.value;
  if (start === "" || end === "") {
    rangeError.value = "请选择开始与结束日期";
    return;
  }
  if (start > end) {
    rangeError.value = "开始日期不能晚于结束日期";
    return;
  }
  rangeError.value = "";
  submitted.value = { mode: "custom", startDate: start, endDate: end };
}

/**
 * 把 UTC 边界按 manifest 时区显示为 `YYYY-MM-DD HH:mm`。
 * @param iso ISO 时间串。
 * @returns 展示文本；解析失败原样返回。
 */
function formatBoundary(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone.value,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
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

function ownerNames(item: TaskChange): string {
  return item.owners.map((owner) => owner.name).join("、") || "待分配";
}

function progressText(item: TaskChange): string {
  const delta = item.before ? item.after.progress - item.before.progress : item.after.progress;
  const sign = delta >= 0 ? "▲" : "▼";
  return `${item.before ? `${item.before.progress}% → ` : "新建 → "}${item.after.progress}% ${sign}`;
}

function progressTone(item: TaskChange): "up" | "down" {
  const delta = item.before ? item.after.progress - item.before.progress : item.after.progress;
  return delta >= 0 ? "up" : "down";
}

/** 行级增删统计；与 ProgressDiff 使用同一纯函数，避免两处口径漂移。 */
function lineStats(item: TaskChange): { added: number; removed: number } {
  const { added, removed } = buildDiffColumns(item.before?.detail ?? "", item.after.detail);
  return { added, removed };
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
      <button type="button" class="btn ghost range-preset" :class="{ active: submitted.mode === 'default' }" @click="useDefaultRange">
        昨天至今
      </button>
    </div>

    <div class="range-controls">
      <label class="range-field">
        <span>开始日期</span>
        <input v-model="startInput" type="date" aria-label="历史开始日期" @input="rangeError = ''">
      </label>
      <span class="arrow" aria-hidden="true">→</span>
      <label class="range-field">
        <span>结束日期</span>
        <input v-model="endInput" type="date" aria-label="历史结束日期" @input="rangeError = ''">
      </label>
      <button type="button" class="btn primary" @click="queryCustom">查询</button>
      <button type="button" class="btn ghost range-now" @click="refreshToNow">
        {{ submitted.mode === "default" ? "↻ 更新至现在" : "↻ 回到昨天至今" }}
      </button>
      <span v-if="rangeError" class="range-error" role="alert">{{ rangeError }}</span>
    </div>

    <p class="range-boundary">
      {{ submitted.mode === "default"
        ? "默认查询昨天 00:00 至当前时刻；结束时间不会延伸到今天 23:59"
        : "自定义日期：开始于 00:00，结束于 23:59，包含起止两天" }}
    </p>

    <div class="range-result" aria-live="polite">
      <LoadingState v-if="changesQuery.isLoading.value" label="历史变化加载中…" />
      <ErrorState
        v-else-if="changesQuery.isError.value"
        message="历史变化加载失败"
        retryable
        @retry="changesQuery.refetch()"
      />
      <template v-else>
        <div class="range-status">
          <span class="status-dot" aria-hidden="true" />
          <span class="status-label">{{ submitted.mode === "default" ? "已自动查询 · 昨天至今" : "已查询 · 自定义日期" }}</span>
          <time v-if="changesQuery.data.value">
            {{ formatBoundary(changesQuery.data.value.start) }} → {{ formatBoundary(changesQuery.data.value.end) }}
          </time>
        </div>

        <div v-if="items.length === 0" class="range-empty">该时间段内所选范围的任务没有进展变化。</div>

        <template v-else>
          <div class="chg-toolbar">
            <div class="chg-summary">共 <b>{{ items.length }}</b> 个任务有进展变化，点击任务行可单独展开 / 折叠：</div>
            <div class="chg-actions">
              <button type="button" class="btn ghost" @click="expandAll">全部展开</button>
              <button type="button" class="btn ghost" @click="collapseAll">全部折叠</button>
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
                <span class="desc">{{ item.description }}</span>
                <span v-if="item.changeKind === 'created'" class="created-badge">区间内创建</span>
                <span v-if="item.currentlyDeleted" class="deleted-badge">当前已删除</span>
                <span class="chg-owners">{{ ownerNames(item) }}</span>
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
              />
            </div>
          </div>
        </template>
      </template>
    </div>
  </section>
</template>

<style scoped>
.range-panel {
  margin-top: 14px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px 8px;
  box-shadow: var(--shadow);
}

.range-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.range-head h3 {
  font-size: 12.5px;
  font-weight: 650;
}

.range-head p {
  margin-top: 3px;
  font-size: 11px;
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

.btn.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.btn.ghost {
  border-color: transparent;
  color: var(--text-dim);
}

.range-preset.active {
  color: var(--blue);
  border-color: color-mix(in srgb, var(--blue) 45%, transparent);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
}

.range-controls {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 12px;
}

.range-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 10.5px;
  color: var(--text-faint);
}

.range-field input {
  font: inherit;
  font-size: 12px;
  color: var(--text);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 8px;
}

.arrow {
  color: var(--text-faint);
  padding-bottom: 6px;
}

.range-error {
  font-size: 11px;
  color: var(--red);
  padding-bottom: 6px;
}

.range-boundary {
  margin-top: 8px;
  font-size: 10.5px;
  color: var(--text-faint);
}

.range-result {
  margin-top: 10px;
}

.range-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-dim);
  padding: 8px 0;
  border-top: 1px solid var(--border);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--green);
}

.range-status time {
  margin-left: auto;
  font-family: var(--mono);
  color: var(--text-faint);
}

.range-empty {
  padding: 26px 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-faint);
}

.chg-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 0 8px;
  flex-wrap: wrap;
}

.chg-summary {
  font-size: 11.5px;
  color: var(--text-dim);
}

.chg-actions {
  display: flex;
  gap: 6px;
}

.chg-list {
  border-top: 1px solid var(--border);
}

.chg-item {
  border-bottom: 1px solid var(--border);
}

.chg-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 8px;
  font: inherit;
  text-align: left;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text);
  flex-wrap: wrap;
}

.chg-row:hover {
  background: var(--bg-inset);
}

.chg-row.deleted .desc {
  color: var(--text-faint);
  text-decoration: line-through;
}

.chg-row .desc {
  font-size: 12.5px;
  font-weight: 600;
  flex: 1;
  min-width: 120px;
}

.chg-owners {
  font-size: 11px;
  color: var(--text-faint);
}

.pchg {
  font-family: var(--mono);
  font-size: 11.5px;
  white-space: nowrap;
}

.pchg.up {
  color: var(--green);
}

.pchg.down {
  color: var(--red);
}

.dstat {
  display: inline-flex;
  gap: 6px;
  font-family: var(--mono);
  font-size: 11px;
}

.dstat .a {
  color: var(--green);
}

.dstat .d {
  color: var(--red);
}

.created-badge,
.deleted-badge {
  font-size: 10px;
  border-radius: 999px;
  padding: 0 7px;
  white-space: nowrap;
}

.created-badge {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
}

.deleted-badge {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
}

.chev {
  font-size: 9px;
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
