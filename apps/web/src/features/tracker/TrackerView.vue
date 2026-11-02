<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember, Task } from "@ztask/shared";
import type { TaskCardModel } from "../../components/task-card-model";
import { adminApi, adminTaskApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import TaskCard from "../../components/TaskCard.vue";
import TaskEditorDialog from "../tasks/TaskEditorDialog.vue";
import TaskDetailDialog from "./TaskDetailDialog.vue";
import FolderTree from "../folders/FolderTree.vue";
import PaneResizer from "../../components/ui/PaneResizer.vue";
import EmptyState from "../../components/ui/EmptyState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import { isShareUnauthorized, useShareSession } from "../share/useShareSession";
import { readPreference, writePreference } from "../../lib/preferences";

/**
 * 事项跟踪视图（02 §3/§8、08 §6.3，管理端与成员只读共用）：
 * 查询参数驱动服务端筛选（folder 深链、importance/q 服务端查询），统一只读任务卡。
 * 管理端经 TaskEditorDialog 编辑；成员域（scope=share）只发 `GET /share/**`（05 §6.4–6.5/§6.11），
 * 不注册任何编辑 mutation，点击卡片打开只读 TaskDetailDialog。
 * deleted/current 的看板与历史展示接口留给 m5。
 */
const props = defineProps<{ access?: "admin" | "readonly"; scope?: "admin" | "share" }>();

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const shareSession = useShareSession();

/** 成员只读域永不渲染写入口（08 §6.3），scope=share 单独出现也按只读处理。 */
const isAdmin = computed(() => props.access !== "readonly" && props.scope !== "share");
const isShareScope = computed(() => props.scope === "share");

const scopePrefix = computed(() => (isShareScope.value ? "share" : "admin"));
const treeWidth = ref(readPreference("treeWidth") ?? 340);

watch(treeWidth, (value) => {
  writePreference("treeWidth", value);
});

const activeTab = computed<"tasks" | "dash">(() => (route.query.tab === "dash" ? "dash" : "tasks"));
const selectedFolderId = computed(() => (typeof route.query.folder === "string" && route.query.folder ? route.query.folder : null));
/** 成员域未选任务夹时展示「全部任务夹」的相关任务；管理端仍需先选夹（08 §2.1）。 */
const canLoadTasks = computed(() => isShareScope.value || selectedFolderId.value !== null);

function switchTab(tab: "tasks" | "dash"): void {
  void router.replace({ query: { ...route.query, tab } });
}

const importanceFilter = ref<"all" | "high" | "mid" | "low">("all");
const searchText = ref("");
const debouncedQ = ref("");
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

watch(searchText, (value) => {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedQ.value = value.trim();
  }, 300);
});

/** share 分页游标：null 为第一页；点击「加载更多」续页（05 §6.4 `nextCursor`）。 */
const pageCursor = ref<string | null>(null);
/** 跨页累计的任务；成员域追加，管理端始终只有第一页。 */
const accumulated = ref<Task[]>([]);
const nextCursor = ref<string | null>(null);

const tasksQuery = useQuery({
  queryKey: [scopePrefix.value, "tasks", selectedFolderId, debouncedQ, importanceFilter, pageCursor],
  queryFn: () =>
    isShareScope.value
      ? shareApi.tracker({
          folderId: selectedFolderId.value ?? undefined,
          q: debouncedQ.value || undefined,
          importance: importanceFilter.value === "all" ? undefined : importanceFilter.value,
          cursor: pageCursor.value ?? undefined,
        })
      : adminTaskApi.list({
          folderId: selectedFolderId.value ?? "",
          includeDescendants: true,
          q: debouncedQ.value || undefined,
          importance: importanceFilter.value === "all" ? undefined : importanceFilter.value,
        }),
  enabled: canLoadTasks,
  refetchInterval: 15_000,
});

watch(
  () => tasksQuery.data.value,
  (data) => {
    if (!data) return;
    if (pageCursor.value === null) {
      accumulated.value = data.items ?? [];
    } else {
      const seen = new Set(accumulated.value.map((item) => item.id));
      accumulated.value = [...accumulated.value, ...(data.items ?? []).filter((item) => !seen.has(item.id))];
    }
    nextCursor.value = data.nextCursor ?? null;
  },
  { immediate: true },
);

// 切换任务夹/筛选/搜索会回到第一页，避免游标跨筛选条件复用（05 §6.4）。
watch([selectedFolderId, debouncedQ, importanceFilter], () => {
  pageCursor.value = null;
  nextCursor.value = null;
  accumulated.value = [];
});

const foldersQuery = useQuery({
  queryKey: [scopePrefix.value, "folders", "tree"],
  queryFn: () => (isShareScope.value ? shareApi.foldersTree() : adminApi.folderTree()),
  refetchInterval: 15_000,
});

const membersQuery = useQuery({
  queryKey: [scopePrefix.value, "members"],
  queryFn: adminApi.members,
  enabled: computed(() => !isShareScope.value),
  refetchInterval: 30_000,
});

// 成员域 401（会话过期/链接失效）统一清理缓存并进入失效页（08 §7），不显示普通错误态。
watch(
  () => [tasksQuery.error.value, foldersQuery.error.value] as const,
  ([taskError, folderError]) => {
    if (!isShareScope.value) return;
    if (taskError) shareSession.handleAuthError(taskError);
    if (folderError) shareSession.handleAuthError(folderError);
  },
  { immediate: true },
);

const activeMembers = computed<AdminMember[]>(() =>
  (membersQuery.data.value?.items ?? []).filter((member) => member.archivedAt === null),
);

const folderNameById = computed(() => {
  const map = new Map<string, string>();
  const walk = (nodes: { id: string; name: string; children: unknown[] }[]): void => {
    for (const node of nodes) {
      map.set(node.id, node.name);
      walk((node.children as { id: string; name: string; children: unknown[] }[]) ?? []);
    }
  };
  walk(foldersQuery.data.value?.tree ?? []);
  return map;
});

// 成员树只含相关任务夹：URL 里的 folder 若不在可见树中，回退到「全部任务夹」（08 §2.1）。
watch([() => foldersQuery.data.value, selectedFolderId], ([tree]) => {
  if (!isShareScope.value || !tree) return;
  const folderId = selectedFolderId.value;
  if (folderId === null || folderNameById.value.has(folderId)) return;
  const query = { ...route.query };
  delete query.folder;
  void router.replace({ query });
});

const taskItems = computed(() => accumulated.value);
const showLoadMore = computed(() => isShareScope.value && nextCursor.value !== null);
const taskErrorIsAuth = computed(() => isShareScope.value && isShareUnauthorized(tasksQuery.error.value));
const showTaskError = computed(() => canLoadTasks.value && tasksQuery.isError.value && !taskErrorIsAuth.value);

const emptyTitle = computed(() => {
  if (debouncedQ.value) return "没有匹配的任务";
  return isShareScope.value ? "暂无相关任务" : "暂无任务";
});
/** 只读空态不提示新建任务（02 §5）：成员域说明范围而不是给写入口。 */
const emptyHint = computed(() => {
  if (debouncedQ.value) return "调整搜索关键词或筛选条件";
  return isShareScope.value ? "当前范围内没有与你相关的任务；成员视图为只读。" : "点击「＋ 新建任务」创建第一个任务";
});

function toCardModel(task: Task): TaskCardModel {
  return {
    id: task.id,
    description: task.description,
    folderName: folderNameById.value.get(task.folderId),
    owners: task.owners.map((owner) => owner.name),
    importance: task.importance,
    dueDate: task.dueDate,
    progress: task.progress,
    detail: task.detail,
    subtasks: task.subtasks.map((sub) => ({
      id: sub.id,
      description: sub.description,
      progress: sub.progress,
      ownerName: sub.owner?.name,
    })),
  };
}

function loadMore(): void {
  if (!isShareScope.value || nextCursor.value === null) return;
  pageCursor.value = nextCursor.value;
}

const editorOpen = ref(false);
const editorTask = ref<Task | null>(null);

const detailOpen = ref(false);
const detailTaskId = ref<string | null>(null);

function openEditor(task: Task): void {
  editorTask.value = task;
  editorOpen.value = true;
}

function openEditorById(taskId: string): void {
  if (!isAdmin.value) return;
  const task = accumulated.value.find((item) => item.id === taskId);
  if (task) openEditor(task);
}

/** 只读详情：成员点击任务卡，不创建编辑草稿（08 §6.3）。 */
function openTaskDetail(taskId: string): void {
  detailTaskId.value = taskId;
  detailOpen.value = true;
  // 03 §2：`?task=<id>` 可分享/可后退，成员只读详情同样写回 URL。
  if (isShareScope.value && route.query.task !== taskId) {
    void router.replace({ query: { ...route.query, task: taskId } });
  }
}

/** `?task=` 深链在成员域直接打开只读详情（03 §2）。 */
const taskParam = computed(() => (typeof route.query.task === "string" && route.query.task ? route.query.task : null));
watch(taskParam, (taskId) => {
  if (!isShareScope.value) return;
  if (taskId === null) {
    detailOpen.value = false;
    detailTaskId.value = null;
    return;
  }
  detailTaskId.value = taskId;
  detailOpen.value = true;
}, { immediate: true });

function onTaskOpen(taskId: string): void {
  if (isAdmin.value) {
    openEditorById(taskId);
    return;
  }
  openTaskDetail(taskId);
}

function closeTaskDetail(): void {
  detailOpen.value = false;
  detailTaskId.value = null;
  if (route.query.task !== undefined) {
    const query = { ...route.query };
    delete query.task;
    void router.replace({ query });
  }
}

function openCreate(): void {
  if (!isAdmin.value) return;
  editorTask.value = null;
  editorOpen.value = true;
}

/** 保存后失效键按数据域区分；成员域没有写路径，不会触发（08 §6.3）。 */
function onSaved(): void {
  void queryClient.invalidateQueries({ queryKey: [scopePrefix.value, "tasks"] });
  void queryClient.invalidateQueries({ queryKey: [scopePrefix.value, "folders"] });
}

const treeSide = ref<HTMLElement | null>(null);

function onTreeDrag(clientX: number): void {
  const left = treeSide.value?.getBoundingClientRect().left ?? 0;
  treeWidth.value = Math.min(480, Math.max(220, clientX - left));
}
</script>

<template>
  <div class="tracker">
    <aside ref="treeSide" class="tree-side" :style="{ width: `${treeWidth}px` }">
      <div class="tree-head">
        <h2>任务夹</h2>
      </div>
      <div class="tree-body">
        <FolderTree :can-edit="isAdmin" :scope="scopePrefix" />
      </div>
    </aside>

    <PaneResizer
      v-model="treeWidth"
      label="调整任务树宽度"
      :min="220"
      :max="480"
      class="tree-resizer"
      @drag="onTreeDrag"
    />

    <main class="board">
      <div class="board-head">
        <div class="crumb">
          <span class="path">{{ selectedFolderId ? folderNameById.get(selectedFolderId) ?? "选中任务夹" : "全部任务夹" }}</span>
          <span class="scope-hint">包含子任务夹中的全部任务</span>
        </div>
        <div class="tabs" role="tablist" aria-label="事项跟踪视图">
          <button type="button" role="tab" :aria-selected="activeTab === 'tasks'" :class="{ active: activeTab === 'tasks' }" @click="switchTab('tasks')">任务管理</button>
          <button type="button" role="tab" :aria-selected="activeTab === 'dash'" :class="{ active: activeTab === 'dash' }" @click="switchTab('dash')">情况看板</button>
        </div>
      </div>

      <div v-if="activeTab === 'tasks'" class="board-body">
        <div class="toolbar">
          <button v-if="isAdmin" class="btn primary" type="button" :disabled="!selectedFolderId" title="先选择任务夹" @click="openCreate">＋ 新建任务</button>
          <span v-if="!isAdmin" class="ro-tag">只读视图 · 数据来自你有权查看的范围</span>
          <span class="spacer" />
          <span class="flabel">重要度</span>
          <button
            v-for="level in ['all', 'high', 'mid', 'low'] as const"
            :key="level"
            type="button"
            :class="importanceFilter === level ? 'fchip active' : 'fchip'"
            @click="importanceFilter = level"
          >{{ level === "all" ? "全部" : level === "high" ? "高" : level === "mid" ? "中" : "低" }}</button>
          <input v-model="searchText" class="search-box" type="search" placeholder="搜索任务描述…" aria-label="搜索任务描述">
        </div>

        <LoadingState v-if="canLoadTasks && tasksQuery.isLoading.value" label="任务加载中…" />
        <ErrorState
          v-else-if="showTaskError && taskItems.length === 0"
          message="任务加载失败"
          retryable
          @retry="tasksQuery.refetch()"
        />
        <EmptyState v-else-if="!canLoadTasks" title="先选择任务夹" hint="在左侧任务夹树中选择一个任务夹以查看任务" />
        <div v-else class="task-list">
          <TaskCard v-for="task in taskItems" :key="task.id" :task="toCardModel(task)" @open="onTaskOpen" />
          <EmptyState
            v-if="taskItems.length === 0 && !tasksQuery.isFetching.value"
            :title="emptyTitle"
            :hint="emptyHint"
          />
          <button
            v-if="showLoadMore"
            class="btn load-more"
            type="button"
            :disabled="tasksQuery.isFetching.value"
            @click="loadMore"
          >{{ tasksQuery.isFetching.value ? "加载中…" : "加载更多" }}</button>
        </div>
        <p class="hint-line">
          {{ isAdmin ? "任务进展为只读视图；点击任务标题区可在浮窗中查看或编辑完整任务。" : "成员视图为只读；点击任务可查看完整详情。" }}
        </p>
      </div>

      <div v-else class="board-body">
        <EmptyState
          :title="isShareScope ? '情况看板暂未开放' : undefined"
          :hint="isShareScope
            ? '当前版本可在成员个人页与任务管理中查看你的相关事项；统计与历史将在后续版本提供。'
            : '情况看板统计与历史变化将在 m5 接入'"
        />
      </div>
    </main>

    <TaskEditorDialog
      v-if="isAdmin"
      :open="editorOpen"
      :folder-id="selectedFolderId"
      :task="editorTask"
      :members="activeMembers"
      @close="editorOpen = false"
      @saved="onSaved"
    />

    <TaskDetailDialog
      v-if="isShareScope"
      :open="detailOpen"
      :task-id="detailTaskId"
      @close="closeTaskDetail"
    />
  </div>
</template>

<style scoped>
.tracker {
  display: flex;
  align-items: stretch;
  height: calc(100vh - 46px);
  overflow: hidden;
}

.tree-side {
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  min-width: 220px;
  max-width: 480px;
}

.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

.tree-head h2 {
  font-size: 12.5px;
  color: var(--text-dim);
}

.tree-body {
  padding: 10px 12px;
  overflow: auto;
  flex: 1;
}

.tree-resizer {
  align-self: center;
  height: 100%;
}

.board {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.board-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.crumb {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.path {
  font-size: 12.5px;
  font-weight: 600;
}

.scope-hint {
  font-size: 10.5px;
  color: var(--text-faint);
}

.tabs {
  display: flex;
  gap: 2px;
}

.tabs button {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: var(--text-dim);
  padding: 5px 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tabs button.active {
  color: var(--blue);
  border-bottom-color: var(--blue);
  font-weight: 600;
}

.board-body {
  padding: 12px 16px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar .spacer {
  flex: 1;
}

.flabel {
  font-size: 11px;
  color: var(--text-faint);
}

.fchip {
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 12px;
  cursor: pointer;
}

.fchip.active {
  color: var(--blue);
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 8%, var(--bg-card));
}

.search-box {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 4px 10px;
  width: 180px;
  background: var(--bg-card);
  color: var(--text);
}

.ro-tag {
  font-size: 11px;
  color: var(--text-faint);
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
  padding: 3px 10px;
}

.hint-line {
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

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.load-more {
  align-self: center;
}

@media (max-width: 900px) {
  .tracker {
    flex-direction: column;
    height: auto;
    overflow: visible;
  }

  .tree-side {
    width: 100% !important;
    max-width: none;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .tree-resizer {
    display: none;
  }

  .search-box {
    width: 130px;
  }
}
</style>
