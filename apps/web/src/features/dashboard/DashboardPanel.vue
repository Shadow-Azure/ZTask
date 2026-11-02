<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { DashboardDueDistribution, DueBucket, DashboardSummary, Importance, ProgressBucket } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";

/**
 * 情况看板（05 §5.1–5.2、§6.12–6.13，02 §7，原型 1352–1445）：
 * 三统计卡 + 成员多选过滤 + 点击卡片展开该集合的预计完成时间堆叠柱。
 * 管理员与成员复用同一组 DTO 与渲染，只有数据范围不同（成员域不提供成员过滤，避免探测他人）。
 */
const props = defineProps<{
  /** admin = 全团队可筛选；share = 当前成员相关任务，无成员筛选。 */
  access: "admin" | "share";
  /** 必填：看板统计以当前任务夹及后代为范围。 */
  folderId: string | null;
}>();

type BucketKey = "done" | "gt50" | "lt50";
type DueKey = "overdue" | "week" | "month" | "later" | "unscheduled";

const IMPORTANCE_NAMES: Record<Importance, string> = { high: "高", mid: "中", low: "低" };
const DUE_LABELS: Record<DueKey, string> = {
  overdue: "已逾期",
  week: "一周内",
  month: "一月内",
  later: "一月后",
  unscheduled: "未排期",
};

const BUCKET_DEFS: ReadonlyArray<{ key: BucketKey; title: string; sub: string }> = [
  { key: "done", title: "已完成", sub: "进度 100%" },
  { key: "gt50", title: "进行中 · 完成度 > 50%", sub: "进度 51–99%" },
  { key: "lt50", title: "进行中 · 完成度 ≤ 50%", sub: "进度 0–50%" },
];

/** 已选成员（仅管理员）；空 = 全部。 */
const selectedMembers = ref<string[]>([]);
/** 当前展开分布图的统计卡；null = 收起。 */
const activeBucket = ref<BucketKey | null>(null);

/** 管理员成员目录（chips 来源）。 */
const membersQuery = useQuery({
  queryKey: ["admin", "members"],
  queryFn: adminApi.members,
  enabled: computed(() => props.access === "admin"),
  staleTime: 15_000,
});

/** 分享域没有成员目录端点：从「我的相关任务」的分配里汇总可见成员（08 §4.1 脱敏目录）。 */
const shareHomeQuery = useQuery({
  queryKey: ["share", "tasks", "home"],
  queryFn: shareApi.home,
  enabled: computed(() => props.access === "share"),
  staleTime: 15_000,
});

/** chips 列表：管理员=在册成员；分享域=相关任务里出现过的成员摘要（去重、稳定排序）。 */
const chipMembers = computed(() => {
  if (props.access === "admin") {
    return (membersQuery.data.value?.items ?? [])
      .filter((member) => member.archivedAt === null)
      .map((member) => ({ id: member.id, name: member.name, color: member.color }));
  }
  const seen = new Map<string, { id: string; name: string; color: string }>();
  for (const task of [
    ...(shareHomeQuery.data.value?.owned ?? []),
    ...(shareHomeQuery.data.value?.collaborated ?? []),
  ]) {
    for (const member of [...task.owners, ...task.collaborators, ...task.subtasks.map((subtask) => subtask.owner)]) {
      if (!seen.has(member.id)) seen.set(member.id, { id: member.id, name: member.name, color: member.color });
    }
  }
  return [...seen.values()].sort((a, b) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1));
});

/** 稳定排序的成员筛选：URL 语义与 query key 都不受点击顺序影响。 */
const memberIds = computed(() => [...selectedMembers.value].sort());

const summaryQuery = useQuery({
  queryKey: computed(() => ["dashboard", "summary", props.access, props.folderId, memberIds.value.join(",")]),
  queryFn: () =>
    props.access === "admin"
      ? adminApi.dashboardSummary({ folderId: props.folderId!, memberIds: memberIds.value })
      : shareApi.dashboardSummary({ folderId: props.folderId!, memberIds: memberIds.value }),
  enabled: computed(() => props.folderId !== null),
  // 03 §7：看板 15s 轮询；切到后台 tab 暂停，回到前台由 focus 失效刷新。
  refetchInterval: () => (document.visibilityState === "hidden" ? false : 15_000),
  refetchOnWindowFocus: true,
});

const dueQuery = useQuery({
  queryKey: computed(() => ["dashboard", "due", props.access, props.folderId, memberIds.value.join(","), activeBucket.value]),
  queryFn: () =>
    props.access === "admin"
      ? adminApi.dashboardDueDistribution({
          folderId: props.folderId!,
          bucket: activeBucket.value!,
          memberIds: memberIds.value,
        })
      : shareApi.dashboardDueDistribution({
          folderId: props.folderId!,
          bucket: activeBucket.value!,
          memberIds: memberIds.value,
        }),
  enabled: computed(() => props.folderId !== null && activeBucket.value !== null),
  // 08 §4.1：切换筛选后 summary 与展开的 distribution 一起刷新；分布同样 15s 轮询、后台暂停。
  refetchInterval: () => (document.visibilityState === "hidden" ? false : 15_000),
  refetchOnWindowFocus: true,
});

const summary = computed<DashboardSummary | null>(() => summaryQuery.data.value ?? null);

/**
 * 取某统计桶的 DTO；后端固定返回三个键。
 * @param key done/gt50/lt50。
 * @returns 统计桶（含重要度计数）。
 */
function bucketOf(key: BucketKey): ProgressBucket {
  return summary.value?.buckets[key] ?? { total: 0, importance: { high: 0, mid: 0, low: 0 } };
}

function toggleMember(memberId: string): void {
  selectedMembers.value = selectedMembers.value.includes(memberId)
    ? selectedMembers.value.filter((id) => id !== memberId)
    : [...selectedMembers.value, memberId];
}

function toggleBucket(key: BucketKey): void {
  activeBucket.value = activeBucket.value === key ? null : key;
}

const chart = computed<DashboardDueDistribution | null>(() => dueQuery.data.value ?? null);
const chartBuckets = computed<DueBucket[]>(() => chart.value?.buckets ?? []);
const chartMax = computed(() => Math.max(1, ...chartBuckets.value.map((bucket) => bucket.total)));
const chartTitle = computed(() => {
  const def = BUCKET_DEFS.find((item) => item.key === activeBucket.value);
  return def ? `${def.title}任务的预计完成时间分布` : "";
});

/**
 * 柱高百分比：以当前集合最大桶为 100%，全部为 0 时也保持 0。
 * @param total 该桶任务数。
 * @returns 0–100 的百分比。
 */
function barHeight(total: number): string {
  return `${Math.round((total / chartMax.value) * 100)}%`;
}

/**
 * 桶文案：已完成集合不存在「逾期」语义，首桶按原型改为「今天以前」。
 * @param key 后端桶键。
 * @returns 展示文案。
 */
function dueLabel(key: DueKey): string {
  if (key === "overdue" && activeBucket.value === "done") return "今天以前";
  return DUE_LABELS[key];
}
</script>

<template>
  <section class="dashboard" aria-label="情况看板">
    <div v-if="chipMembers.length > 0" class="dash-filter">
      <span class="flabel">成员筛选</span>
      <button
        v-for="member in chipMembers"
        :key="member.id"
        type="button"
        class="mchip"
        :class="{ active: selectedMembers.includes(member.id) }"
        :aria-pressed="selectedMembers.includes(member.id)"
        @click="toggleMember(member.id)"
      >
        <span class="chip-ava" :style="{ background: member.color }" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
        {{ member.name }}
      </button>
      <span class="all-hint">{{ access === "admin" ? "不选 = 全部成员" : "不选 = 我的相关任务整体" }}</span>
    </div>

    <div v-if="!folderId" class="dash-empty">
      <p>先选择任务夹</p>
      <span>在左侧任务夹树中选择一个任务夹，看板会统计该夹及其子夹。</span>
    </div>

    <LoadingState v-else-if="summaryQuery.isLoading.value" label="看板加载中…" />
    <ErrorState
      v-else-if="summaryQuery.isError.value"
      message="看板加载失败"
      retryable
      @retry="summaryQuery.refetch()"
    />

    <template v-else>
      <div class="stat-cards">
        <div
          v-for="def in BUCKET_DEFS"
          :key="def.key"
          role="button"
          tabindex="0"
          class="stat-card"
          :class="{ active: activeBucket === def.key }"
          :aria-pressed="activeBucket === def.key"
          :aria-label="`${def.title}，${bucketOf(def.key).total} 项任务，点击${activeBucket === def.key ? '收起' : '查看'}预计完成时间分布`"
          @click="toggleBucket(def.key)"
          @keydown.enter.prevent="toggleBucket(def.key)"
          @keydown.space.prevent="toggleBucket(def.key)"
        >
          <div class="sc-title">
            {{ def.title }}
            <span class="sc-sub">{{ def.sub }}</span>
          </div>
          <div class="sc-total">{{ bucketOf(def.key).total }}<small>项任务</small></div>
          <div class="sc-break">
            <div v-for="level in (['high', 'mid', 'low'] as const)" :key="level" class="sc-cell" :class="level">
              <b>{{ bucketOf(def.key).importance[level] }}</b>
              <span>{{ IMPORTANCE_NAMES[level] }}</span>
            </div>
          </div>
          <div class="sc-hint">
            {{ activeBucket === def.key ? "▾ 再次点击收起分布图" : "▸ 点击查看预计完成时间分布" }}
          </div>
        </div>
      </div>

      <div v-if="activeBucket" class="chart-panel" role="region" :aria-label="chartTitle">
        <h3>{{ chartTitle }}</h3>
        <LoadingState v-if="dueQuery.isLoading.value" label="分布加载中…" />
        <ErrorState
          v-else-if="dueQuery.isError.value"
          message="分布加载失败"
          retryable
          @retry="dueQuery.refetch()"
        />
        <div v-else-if="(chart?.buckets ?? []).every((bucket) => bucket.total === 0)" class="chart-empty">
          该集合暂无任务，换个统计卡片{{ access === "admin" ? "或调整成员筛选" : "" }}试试。
        </div>
        <div v-else class="chart">
          <div v-for="bucket in chartBuckets" :key="bucket.key" class="chart-col">
            <div class="chart-track" role="img" :aria-label="`${dueLabel(bucket.key as DueKey)} ${bucket.total} 项任务，高 ${bucket.importance.high}、中 ${bucket.importance.mid}、低 ${bucket.importance.low}`">
              <div class="chart-bar" :style="{ height: barHeight(bucket.total) }">
                <span class="seg high" :style="{ flexGrow: bucket.importance.high }" />
                <span class="seg mid" :style="{ flexGrow: bucket.importance.mid }" />
                <span class="seg low" :style="{ flexGrow: bucket.importance.low }" />
              </div>
            </div>
            <div class="chart-total">{{ bucket.total }}</div>
            <div class="chart-label" :class="{ emphasis: bucket.key === 'overdue' && activeBucket !== 'done' }">
              {{ dueLabel(bucket.key as DueKey) }}
            </div>
          </div>
        </div>
        <div v-if="chart && (chart.buckets ?? []).some((bucket) => bucket.total > 0)" class="legend">
          <span><i class="li high" />高</span>
          <span><i class="li mid" />中</span>
          <span><i class="li low" />低</span>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dash-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.flabel {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 600;
}

.mchip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 12px 3px 5px;
  background: var(--bg-card);
  font: inherit;
}

.mchip:hover {
  border-color: var(--border-strong);
}

.mchip.active {
  color: var(--text);
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
  font-weight: 600;
}

.chip-ava {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  flex: none;
}

.all-hint {
  font-size: 11px;
  color: var(--text-faint);
}

.stat-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.stat-card {
  text-align: left;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px 12px;
  cursor: pointer;
  box-shadow: var(--shadow);
  font: inherit;
  color: var(--text);
  transition: border-color 0.12s, box-shadow 0.12s;
}

.stat-card:hover {
  border-color: var(--border-strong);
}

.stat-card.active {
  border-color: var(--blue);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--blue) 14%, transparent);
}

.sc-title {
  font-size: 12.5px;
  font-weight: 650;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.sc-sub {
  font-size: 10.5px;
  color: var(--text-faint);
  font-weight: 400;
}

.sc-total {
  margin-top: 8px;
  font-family: var(--mono);
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.sc-total small {
  font-family: inherit;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-faint);
  margin-left: 5px;
}

.sc-break {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.sc-cell {
  flex: 1;
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 11px;
  color: var(--text-faint);
  background: var(--bg-inset);
  border-radius: 7px;
  padding: 4px 8px;
}

.sc-cell b {
  font-family: var(--mono);
  font-size: 13px;
}

.sc-cell.high b {
  color: var(--red);
}

.sc-cell.mid b {
  color: var(--orange);
}

.sc-cell.low b {
  color: var(--text-dim);
}

.sc-hint {
  margin-top: 9px;
  font-size: 10.5px;
  color: var(--text-faint);
}

.chart-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px 16px;
  box-shadow: var(--shadow);
}

.chart-panel h3 {
  font-size: 12.5px;
  font-weight: 650;
  margin-bottom: 14px;
}

.chart {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  align-items: end;
  min-height: 168px;
}

.chart-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.chart-track {
  display: flex;
  align-items: flex-end;
  width: 100%;
  height: 130px;
  background: var(--bg-inset);
  border-radius: 8px;
  padding: 4px;
  box-sizing: border-box;
}

.chart-bar {
  display: flex;
  flex-direction: column;
  width: 100%;
  border-radius: 5px;
  overflow: hidden;
  min-height: 2px;
}

.chart-bar .seg {
  min-height: 0;
}

.chart-bar .seg.high {
  background: var(--red);
}

.chart-bar .seg.mid {
  background: var(--orange);
}

.chart-bar .seg.low {
  background: #8a93a1;
}

.chart-total {
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 700;
}

.chart-label {
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
}

.chart-label.emphasis {
  color: var(--red);
  font-weight: 600;
}

.chart-empty {
  padding: 26px 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-faint);
}

.legend {
  display: flex;
  gap: 14px;
  justify-content: flex-end;
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-faint);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend .li {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  display: inline-block;
}

.legend .li.high {
  background: var(--red);
}

.legend .li.mid {
  background: var(--orange);
}

.legend .li.low {
  background: #8a93a1;
}

.dash-empty {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 34px 16px;
  text-align: center;
}

.dash-empty p {
  font-size: 13px;
  font-weight: 600;
}

.dash-empty span {
  display: block;
  margin-top: 6px;
  font-size: 11.5px;
  color: var(--text-faint);
}

@media (max-width: 900px) {
  .stat-cards {
    grid-template-columns: 1fr;
  }

  .chart {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
