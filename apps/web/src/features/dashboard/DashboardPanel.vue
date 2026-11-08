<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { keepPreviousData, useQuery } from "@tanstack/vue-query";
import type {
  DashboardDueDistribution,
  DashboardTaskListItem,
  DashboardTasks,
  DueBucket,
  DashboardSummary,
  Importance,
  ProgressBucket,
} from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import ChangesPanel from "../history/ChangesPanel.vue";

/**
 * 情况看板（05 §5.1–5.2、§6.12–6.13，02 §7，原型 1352–1445）：
 * 三统计卡 + 成员多选过滤 + 点击卡片展开该集合的预计完成时间堆叠柱。
 * 管理员与成员复用同一组 DTO 与渲染；全员可见后两边都统计团队全部任务，成员筛选按 owner 口径缩小。
 * 视觉对齐原型 269–298（D14）：统计卡三格居中、24px mono 总数；58px 渐变柱、段内白色计数、
 * 柱顶总数、x 轴动态日期副标签、图例右置；栅格按后端固定 5 桶展开（含「未排期」，02 §7.6）。
 */
const props = defineProps<{
  /** admin / share 都统计团队全部任务；share 的成员筛选选项来自任务卡里的成员摘要。 */
  access: "admin" | "share";
  /** 必填：看板统计以当前任务夹及后代为范围。 */
  folderId: string | null;
}>();

const emit = defineEmits<{ openTask: [taskId: string] }>();

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

/** 分享域没有成员目录端点：从团队全部任务的分配里汇总成员摘要（08 §4.1 脱敏目录）。 */
const shareHomeQuery = useQuery({
  queryKey: ["share", "tasks", "home"],
  queryFn: shareApi.home,
  enabled: computed(() => props.access === "share"),
  staleTime: 15_000,
});

/** chips 列表：管理员=在册成员；分享域=团队任务里出现过的成员摘要（去重、稳定排序）。 */
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
    ...(shareHomeQuery.data.value?.others ?? []),
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
  // 成员筛选切换会换 query key；保留上一份 summary，避免整块内容走 LoadingState。
  // ChangesPanel 因此不会被卸载，已提交的自定义时间段与折叠状态得以保留（08 §4.1）。
  placeholderData: keepPreviousData,
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

/**
 * 卡片任务列表面包屑式位置栈：每一页记录进入该页的 cursor，上一页直接回退。
 * 只依赖服务端返回 opaque cursor，不在前端拼 offset 或页码（05 §1）。
 */
const taskPageCursors = ref<Array<string | null>>([null]);
const taskPageIndex = ref(0);
const taskCursor = computed(() => taskPageCursors.value[taskPageIndex.value] ?? null);

const tasksQuery = useQuery({
  queryKey: computed(() => [
    "dashboard",
    "tasks",
    props.access,
    props.folderId,
    memberIds.value.join(","),
    activeBucket.value,
    taskCursor.value,
  ]),
  queryFn: () =>
    props.access === "admin"
      ? adminApi.dashboardTasks({
          folderId: props.folderId!,
          bucket: activeBucket.value!,
          memberIds: memberIds.value,
          cursor: taskCursor.value ?? undefined,
        })
      : shareApi.dashboardTasks({
          folderId: props.folderId!,
          bucket: activeBucket.value!,
          memberIds: memberIds.value,
          cursor: taskCursor.value ?? undefined,
        }),
  enabled: computed(() => props.folderId !== null && activeBucket.value !== null),
  refetchInterval: () => (document.visibilityState === "hidden" ? false : 15_000),
  refetchOnWindowFocus: true,
});

// 卡片/成员/任务夹变化时回到第一页；游标不能跨筛选条件复用。
// 成员与卡片在交互函数里显式 reset，任务夹只可能是父级 prop 变化，单独监听。
function resetTaskPage(): void {
  taskPageCursors.value = [null];
  taskPageIndex.value = 0;
}

watch(() => props.folderId, resetTaskPage);

const dashboardTasks = computed<DashboardTasks | null>(() => tasksQuery.data.value ?? null);
const taskItems = computed<DashboardTaskListItem[]>(() => dashboardTasks.value?.items ?? []);
const taskTotal = computed(() => dashboardTasks.value?.total ?? 0);
const taskPageSize = computed(() => dashboardTasks.value?.pageSize ?? 5);
const taskPageCount = computed(() => Math.max(1, Math.ceil(taskTotal.value / taskPageSize.value)));
const canPrevPage = computed(() => taskPageIndex.value > 0);
const canNextPage = computed(
  () => taskPageIndex.value + 1 < taskPageCount.value && dashboardTasks.value?.nextCursor !== null,
);

// 15s 轮询后总数可能缩小：当前页越界时回到第一页，避免停留在空页。
// 翻页请求刚发出时 data 会短暂为空，此时不能把 index 当成越界。
watch([taskPageCount, () => tasksQuery.isLoading.value], ([count, loading]) => {
  if (loading) return;
  if (taskPageIndex.value >= count) resetTaskPage();
});

function prevTaskPage(): void {
  if (canPrevPage.value) taskPageIndex.value -= 1;
}

function nextTaskPage(): void {
  const cursor = dashboardTasks.value?.nextCursor;
  if (cursor === null || cursor === undefined) return;
  const next = taskPageIndex.value + 1;
  taskPageCursors.value = [...taskPageCursors.value.slice(0, next), cursor];
  taskPageIndex.value = next;
}

/** 列表行日期只显示 M-D；未设置时明确写文案，不显示空白。 */
function taskDueShort(dueDate: string | null): string {
  return dueDate === null ? "未设置" : dueDate.slice(5);
}

/** 已完成为 100% 的任务不显示逾期；其余按浏览器本地「今天」比较 YYYY-MM-DD。 */
function taskOverdue(task: DashboardTaskListItem): boolean {
  if (task.dueDate === null || task.progress >= 100) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return task.dueDate < today;
}

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
  resetTaskPage();
}

function toggleBucket(key: BucketKey): void {
  activeBucket.value = activeBucket.value === key ? null : key;
  resetTaskPage();
}

const chart = computed<DashboardDueDistribution | null>(() => dueQuery.data.value ?? null);
const chartBuckets = computed<DueBucket[]>(() => chart.value?.buckets ?? []);
const chartMax = computed(() => Math.max(1, ...chartBuckets.value.map((bucket) => bucket.total)));
const hasBars = computed(() => chartBuckets.value.some((bucket) => bucket.total > 0));

/**
 * 图表标题（原型 1422 titleMap + 1438 拼接）：「已完成任务 / 完成度 > 50% 的任务 /
 * 完成度 ≤ 50% 的任务」+「的预计完成时间分布」（D14：不再拼接「进行中 ·」前缀）。
 */
const chartTitle = computed(() => {
  const titles: Record<BucketKey, string> = {
    done: "已完成任务",
    gt50: "完成度 > 50% 的任务",
    lt50: "完成度 ≤ 50% 的任务",
  };
  const base = titles[activeBucket.value ?? "done"];
  return activeBucket.value === null ? "" : `${base}的预计完成时间分布`;
});

/** 用服务端 asOf 推 x 轴日期副标签（原型 1433–1435：今天 / +7 天 / +30 天，M-D）。 */
function chartDay(offsetDays: number): string {
  const asOf = chart.value?.asOf;
  if (asOf === undefined) return "";
  const base = new Date(asOf);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + offsetDays);
  return `${base.getMonth() + 1}-${String(base.getDate()).padStart(2, "0")}`;
}

/**
 * x 轴副标签：动态日期范围（原型 1434）。
 * @param key 桶键。
 * @returns 如 `10-29 ~ 11-05`；未排期桶无日期语义，返回「未设置预计完成」。
 */
function dueSubLabel(key: DueKey): string {
  if (key === "unscheduled") return "未设置预计完成";
  if (key === "overdue") return `< ${chartDay(0)}`;
  if (key === "week") return `${chartDay(0)} ~ ${chartDay(7)}`;
  if (key === "month") return `${chartDay(7)} ~ ${chartDay(30)}`;
  return `> ${chartDay(30)}`;
}

/**
 * 柱高（px，原型 1448–1451）：以当前集合最大桶为 150px 基准；有值的桶不低于 14px，空桶 3px。
 * @param total 该桶任务数。
 * @returns 柱高像素值。
 */
function barHeightPx(total: number): number {
  const height = Math.round((total / chartMax.value) * 150);
  return Math.max(height, total > 0 ? 14 : 3);
}

/**
 * 段内白色计数（原型 1452–1454）：段高按占该柱总数的百分比；0 计数的段不渲染。
 * @param count 该段任务数。
 * @param total 该柱任务总数。
 * @returns 段高百分比字符串。
 */
function segHeight(count: number, total: number): string {
  return `${Math.round((count / Math.max(1, total)) * 100)}%`;
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
      <span class="all-hint">{{ access === "admin" ? "不选 = 查看整体任务情况" : "不选 = 团队全部任务" }}</span>
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
          :aria-label="`${def.title}，${bucketOf(def.key).total} 项任务，点击${activeBucket === def.key ? '收起' : '查看'}预计完成时间分布与任务列表`"
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
            {{ activeBucket === def.key ? "▾ 再次点击收起分布图与任务列表" : "▸ 点击查看完成时间分布与任务列表" }}
          </div>
        </div>
      </div>

      <div v-if="activeBucket" class="chart-panel" role="region" :aria-label="chartTitle">
        <!-- 原型 285–287：标题行右侧图例。 -->
        <h3>
          {{ chartTitle }}
          <span class="legend">
            <span><i class="li high" />高</span>
            <span><i class="li mid" />中</span>
            <span><i class="li low" />低</span>
          </span>
        </h3>
        <LoadingState v-if="dueQuery.isLoading.value" label="分布加载中…" />
        <ErrorState
          v-else-if="dueQuery.isError.value"
          message="分布加载失败"
          retryable
          @retry="dueQuery.refetch()"
        />
        <div v-else-if="!hasBars" class="chart-empty">
          该集合暂无任务，换个统计卡片{{ access === "admin" ? "或调整成员筛选" : "" }}试试。
        </div>
        <template v-else>
          <!-- 原型 288–295：58px 居中柱、段内白色计数、柱顶总数、渐变填充、图底 1px 基线。 -->
          <div class="chart">
            <div
              v-for="bucket in chartBuckets"
              :key="bucket.key"
              class="bargroup"
              role="img"
              :aria-label="`${dueLabel(bucket.key as DueKey)} ${bucket.total} 项任务，高 ${bucket.importance.high}、中 ${bucket.importance.mid}、低 ${bucket.importance.low}`"
            >
              <span class="btotal">{{ bucket.total }}</span>
              <div class="bar-stack" :style="{ height: `${barHeightPx(bucket.total)}px` }">
                <div
                  v-if="bucket.importance.low > 0"
                  class="bar-seg low"
                  :style="{ height: segHeight(bucket.importance.low, bucket.total) }"
                  :title="`低 ${bucket.importance.low}`"
                >{{ bucket.importance.low }}</div>
                <div
                  v-if="bucket.importance.mid > 0"
                  class="bar-seg mid"
                  :style="{ height: segHeight(bucket.importance.mid, bucket.total) }"
                  :title="`中 ${bucket.importance.mid}`"
                >{{ bucket.importance.mid }}</div>
                <div
                  v-if="bucket.importance.high > 0"
                  class="bar-seg high"
                  :style="{ height: segHeight(bucket.importance.high, bucket.total) }"
                  :title="`高 ${bucket.importance.high}`"
                >{{ bucket.importance.high }}</div>
              </div>
            </div>
          </div>
          <!-- 原型 296–298：x 轴文案带动态日期范围副标签。 -->
          <div class="chart-x">
            <span v-for="bucket in chartBuckets" :key="bucket.key">
              {{ dueLabel(bucket.key as DueKey) }}
              <b>{{ dueSubLabel(bucket.key as DueKey) }}</b>
            </span>
          </div>
        </template>

        <!-- 柱状图下方：该集合的紧凑分页任务列表，行点击复用任务详情浮窗。 -->
        <section
          v-if="!dueQuery.isLoading.value && !dueQuery.isError.value && (tasksQuery.isLoading.value || tasksQuery.isError.value || taskTotal > 0)"
          class="dash-tasklist"
          aria-label="卡片任务列表"
        >
          <div class="dash-tasklist-head">
            <span class="dash-tasklist-title">任务列表</span>
            <span v-if="dashboardTasks" class="dash-tasklist-count">共 {{ taskTotal }} 项</span>
            <span class="dash-tasklist-tip">点击任务行打开详情浮窗</span>
          </div>
          <LoadingState v-if="tasksQuery.isLoading.value" label="任务列表加载中…" />
          <ErrorState
            v-else-if="tasksQuery.isError.value"
            message="任务列表加载失败"
            retryable
            @retry="tasksQuery.refetch()"
          />
          <template v-else>
            <div v-if="taskItems.length" class="dash-tasklist-rows">
              <button
                v-for="task in taskItems"
                :key="task.id"
                type="button"
                class="dash-task-row"
                :title="`查看任务详情：${task.description}`"
                :aria-label="`打开任务详情：${task.description}`"
                @click="emit('openTask', task.id)"
              >
                <span class="dash-dot" :class="task.importance" aria-hidden="true" />
                <span class="dash-task-desc">{{ task.description }}</span>
                <span class="dash-imp" :class="task.importance">{{ IMPORTANCE_NAMES[task.importance] }}</span>
                <span class="dash-owners">
                  <span
                    v-for="owner in task.owners"
                    :key="owner.id"
                    class="dash-ava"
                    :style="{ background: owner.color }"
                    :title="`${owner.name} · ${owner.role}`"
                  >{{ owner.name.slice(0, 1) }}</span>
                  <span v-if="!task.owners.length" class="dash-owners-empty">待分配</span>
                </span>
                <span class="dash-progress" role="img" :aria-label="`任务进度 ${task.progress}%`">
                  <span class="dash-track"><span class="dash-fill" :class="{ done: task.progress >= 100 }" :style="{ width: `${task.progress}%` }" /></span>
                  <span class="dash-pct">{{ task.progress }}%</span>
                </span>
                <span class="dash-due" :class="{ overdue: taskOverdue(task) }">{{ taskDueShort(task.dueDate) }}</span>
                <span class="dash-chev" aria-hidden="true">›</span>
              </button>
            </div>
            <p v-else class="dash-tasklist-empty">本页暂无任务，请回到上一页。</p>
            <div class="dash-tasklist-foot">
              <span class="dash-pageinfo">每页 {{ taskPageSize }} 项 · 共 {{ taskTotal }} 项</span>
              <div class="dash-pager">
                <button type="button" aria-label="上一页" title="上一页" :disabled="!canPrevPage" @click="prevTaskPage">‹</button>
                <span class="dash-pageno" aria-live="polite">{{ taskPageIndex + 1 }} / {{ taskPageCount }}</span>
                <button type="button" aria-label="下一页" title="下一页" :disabled="!canNextPage" @click="nextTaskPage">›</button>
              </div>
            </div>
          </template>
        </section>
      </div>

      <ChangesPanel :access="access" :folder-id="folderId" :member-ids="memberIds" />
    </template>
  </section>
</template>

<style scoped>
/* 原型 261/269/284/302：块级流式排布，间距靠各块自身 margin（相邻外边距合并后
 * 筛选→统计卡 14、统计卡→图表 12、图表→变化面板 16）。此前统一 flex gap 12 会吃掉这套节奏（R4-D4）。 */
.dashboard {
  display: block;
}

.dash-filter {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.flabel {
  font-size: 12px;
  color: var(--text-dim);
  font-weight: 600;
}

.mchip {
  /* `font: inherit` 必须置首：`font` 简写会重置 font-size，写在后面的 12px 会被打回继承的 13px（R3-D6）。 */
  font: inherit;
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

/* 原型 79–80/216：成员 chip 头像 = .ava.sm 18px / 9.5px / 600（此前 9px/400，R4-D4）。 */
.chip-ava {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  font-weight: 600;
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
  /* 原型 269：下边距 4，与图表面板的 12 外边距合并成 12（无图表时与变化面板的 16 合并成 16）。 */
  margin-bottom: 4px;
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

/* 原型 270–282：统计卡 active 蓝描边 + 3px 15% 光环；sc-total 24px mono。 */
.stat-card.active {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--blue) 15%, transparent);
}

/* 原型 273：标题 12px/600 + --text-dim；副标签 10.5px/--text-faint（R3-D8）。 */
.sc-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
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
  margin: 2px 0 8px;
  font-family: var(--mono);
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  color: var(--text);
}

.sc-total small {
  font-family: inherit;
  font-size: 11px;
  font-weight: 400;
  color: var(--text-faint);
  margin-left: 4px;
}

/* 原型 276–280：三格居中（数值上、标签下、格内 inset 底）。 */
.sc-break {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.sc-cell {
  text-align: center;
  background: var(--bg-inset);
  border-radius: 8px;
  padding: 5px 2px 4px;
}

.sc-cell b {
  display: block;
  font-family: var(--mono);
  font-size: 14px;
}

.sc-cell span {
  font-size: 10px;
  color: var(--text-faint);
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
  margin-top: 8px;
  font-size: 10.5px;
  color: var(--text-faint);
}

.stat-card.active .sc-hint {
  color: var(--blue);
}

/* 原型 284–287：图表面板 16/18 内距、上外边距 12（与统计卡下边距 4 合并为 12）；h3 13px/650，图例右置。 */
.chart-panel {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 16px 18px;
  margin-top: 12px;
  box-shadow: var(--shadow);
}

.chart-panel h3 {
  font-size: 13px;
  font-weight: 650;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 0;
}

.chart-panel h3 .legend {
  margin-left: auto;
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 400;
}

.legend .li {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 2.5px;
  margin-right: 4px;
}

.legend .li.high {
  background: var(--red);
}

.legend .li.mid {
  background: var(--orange);
}

.legend .li.low {
  background: var(--low-strong);
}

/*
 * 原型 288：图区 = 单行栅格 + 底部 1px 基线。
 * 后端固定返回 5 桶（overdue/week/month/later/unscheduled，02 §7.6「未排期」独立桶
 * 保证三卡总数与柱合计一致），因此栅格按桶数 5 列展开（原型只有 4 桶是未含未排期语义）。
 */
.chart {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 18px;
  align-items: end;
  height: 190px;
  padding: 18px 8px 0;
  border-bottom: 1px solid var(--border);
}

/* 原型 289：柱组纵向贴底。 */
.bargroup {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  gap: 0;
}

/* 原型 290：58px 柱体、顶部圆角 6、inset 底色兜底。 */
.bar-stack {
  width: 58px;
  display: flex;
  flex-direction: column-reverse;
  border-radius: 6px 6px 0 0;
  overflow: hidden;
  background: var(--bg-inset);
}

/* 原型 291–294：段内白色 mono 计数、渐变填充（高红/中橙/低灰）。 */
.bar-seg {
  display: grid;
  place-items: center;
  color: #fff;
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 600;
  min-height: 0;
}

.bar-seg.high {
  background: linear-gradient(180deg, var(--red-light), var(--red));
}

.bar-seg.mid {
  background: linear-gradient(180deg, var(--orange-light), var(--orange));
}

.bar-seg.low {
  background: linear-gradient(180deg, var(--low-light), var(--low-strong));
}

/* 原型 295：柱顶总数 mono 11px。 */
.btotal {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 4px;
  font-weight: 600;
}

/* 原型 296–298：x 轴标签 + mono 副标签，与柱区同栅格。 */
.chart-x {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 18px;
  padding: 8px 8px 2px;
}

.chart-x span {
  text-align: center;
  font-size: 11.5px;
  color: var(--text-dim);
}

.chart-x b {
  display: block;
  font-size: 10px;
  color: var(--text-faint);
  font-weight: 400;
  font-family: var(--mono);
}

/* 柱状图下方紧凑任务列表：与原型 344–381 对齐，5 行/页。 */
.dash-tasklist {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}

.dash-tasklist-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 7px;
}

.dash-tasklist-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--text);
}

.dash-tasklist-count {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-faint);
}

.dash-tasklist-tip {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--text-faint);
}

.dash-tasklist-rows {
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
  background: var(--bg-card);
}

.dash-task-row {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto auto 92px 46px 8px;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 5px 9px;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #f0f2f5;
}

.dash-task-row:last-child {
  border-bottom: 0;
}

.dash-task-row:hover {
  background: #f7f9fc;
}

.dash-task-row:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: -2px;
}

.dash-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: none;
}

.dash-dot.high {
  background: var(--red);
}

.dash-dot.mid {
  background: var(--orange);
}

.dash-dot.low {
  background: var(--low-strong);
}

.dash-task-desc {
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dash-imp {
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  padding: 0 6px;
  border-radius: 6px;
  white-space: nowrap;
}

.dash-imp.high {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 11%, transparent);
}

.dash-imp.mid {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 13%, transparent);
}

.dash-imp.low {
  color: var(--text-dim);
  background: color-mix(in srgb, var(--text-dim) 12%, transparent);
}

.dash-owners {
  display: flex;
  align-items: center;
  min-width: 18px;
}

.dash-ava {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  font-weight: 600;
  flex: none;
}

.dash-ava + .dash-ava {
  margin-left: -5px;
  box-shadow: 0 0 0 2px var(--bg-card);
}

.dash-owners-empty {
  font-size: 10.5px;
  color: var(--text-faint);
}

.dash-progress {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 92px;
}

.dash-track {
  display: block;
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: #e8ebf0;
  overflow: hidden;
}

.dash-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #6f9bff, var(--blue));
}

.dash-fill.done {
  background: linear-gradient(90deg, #43c58d, #1f9d6b);
}

.dash-pct {
  width: 30px;
  text-align: right;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-dim);
}

.dash-due {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-dim);
  text-align: right;
  white-space: nowrap;
}

.dash-due.overdue {
  color: var(--red);
  font-weight: 600;
}

.dash-chev {
  color: var(--text-faint);
  font-size: 12px;
  line-height: 1;
  text-align: right;
}

.dash-task-row:hover .dash-chev {
  color: var(--blue);
}

.dash-tasklist-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 7px;
}

.dash-pageinfo {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-faint);
}

.dash-pager {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dash-pager button {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.dash-pager button:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-inset);
  border-color: var(--border-strong);
}

.dash-pager button:disabled {
  opacity: 0.35;
  cursor: default;
}

.dash-pageno {
  min-width: 46px;
  text-align: center;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-dim);
}

.dash-tasklist-empty {
  padding: 12px 4px;
  font-size: 11.5px;
  color: var(--text-faint);
}

.chart-empty {
  padding: 26px 0;
  text-align: center;
  font-size: 11.5px;
  color: var(--text-faint);
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

  .chart,
  .chart-x {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 8px;
  }

  .bar-stack {
    width: 40px;
  }

  .dash-task-row {
    grid-template-columns: 8px minmax(0, 1fr) 92px 46px 8px;
  }

  .dash-imp,
  .dash-owners,
  .dash-tasklist-tip {
    display: none;
  }
}
</style>
