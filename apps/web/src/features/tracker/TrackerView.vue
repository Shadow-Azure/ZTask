<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember, FolderTreeNode, Task } from "@ztask/shared";
import type { TaskCardModel } from "../../components/task-card-model";
import { adminApi, adminTaskApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import TaskCard from "../../components/TaskCard.vue";
import TaskEditorDialog from "../tasks/TaskEditorDialog.vue";
import TaskDetailDialog from "./TaskDetailDialog.vue";
import AssigneeFilter from "./AssigneeFilter.vue";
import FolderTree from "../folders/FolderTree.vue";
import DashboardPanel from "../dashboard/DashboardPanel.vue";
import PaneResizer from "../../components/ui/PaneResizer.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import { useToast } from "../../components/ui/toast";
import { isShareUnauthorized, useShareSession } from "../share/useShareSession";
import { readPreference, writePreference } from "../../lib/preferences";
import { describeApiError } from "../../api/error-message";

/**
 * 事项跟踪视图（02 §3/§8、08 §6.3，管理端与成员只读共用）：
 * 查询参数驱动服务端筛选（folder 深链、importance/q 服务端查询），统一只读任务卡。
 * 管理端经 TaskEditorDialog 编辑；成员域（scope=share）只发 `GET /share/**`（05 §6.4–6.5/§6.11），
 * 不注册任何编辑 mutation，点击卡片打开只读 TaskDetailDialog。
 * 面板头对齐原型 607–617：crumb 一行（路径 + N 个任务计数 + scope-hint 右对齐）、tabs 另起一行（D7）；
 * 管理端无 folder query 时默认选中首个根夹（原型 993，D8）；列表/树空态为原型式纯文本（D18）。
 * 看板（情况看板 tab）由 DashboardPanel 复用同一组统计 DTO。
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
/** 成员域未选任务夹时展示「全部任务夹」的任务；管理端由 D8 默认选首个根夹。 */
const canLoadTasks = computed(() => isShareScope.value || selectedFolderId.value !== null);

function switchTab(tab: "tasks" | "dash"): void {
  void router.replace({ query: { ...route.query, tab } });
}

const importanceFilter = ref<"all" | "high" | "mid" | "low">("all");
const searchText = ref("");
const debouncedQ = ref("");
/** 负责人筛选（仅管理员）：owners 逗号串写入 URL，刷新/后退可恢复。 */
function readOwnerIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value.join(",") : value;
  if (typeof raw !== "string" || raw === "") return [];
  return [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
}
const ownerFilter = ref<string[]>(readOwnerIds(route.query.owners));
const ownerFilterKey = computed(() => [...ownerFilter.value].sort().join(","));

watch(ownerFilter, (ids) => {
  const next = ids.length > 0 ? [...ids].sort().join(",") : undefined;
  if ((route.query.owners as string | undefined) === next) return;
  void router.replace({ query: { ...route.query, owners: next } });
});

watch(
  () => route.query.owners,
  (value) => {
    const next = readOwnerIds(value);
    if (next.join(",") !== ownerFilter.value.join(",")) ownerFilter.value = next;
  },
);

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
  queryKey: [scopePrefix.value, "tasks", selectedFolderId, debouncedQ, importanceFilter, ownerFilterKey, pageCursor],
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
          ownerIds: ownerFilter.value.length > 0 ? [...ownerFilter.value].sort() : undefined,
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
watch([selectedFolderId, debouncedQ, importanceFilter, ownerFilterKey], () => {
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

/** URL 里可能残留已归档/不存在的成员 ID：成员目录加载成功后从筛选里剔除，避免“已筛选但无选项”。 */
watch(
  [activeMembers, () => membersQuery.isSuccess.value],
  ([members, loaded]) => {
    if (!isAdmin.value || !loaded) return;
    const known = new Set(members.map((member) => member.id));
    const next = ownerFilter.value.filter((id) => known.has(id));
    if (next.length !== ownerFilter.value.length) ownerFilter.value = next;
  },
);

const folderTree = computed<FolderTreeNode[]>(() => foldersQuery.data.value?.tree ?? []);

const folderNameById = computed(() => {
  const map = new Map<string, string>();
  const walk = (nodes: FolderTreeNode[]): void => {
    for (const node of nodes) {
      map.set(node.id, node.name);
      walk(node.children ?? []);
    }
  };
  walk(folderTree.value);
  return map;
});

/** 任务夹完整路径（「2026 Q4 迭代 / 客户端重构」），供编辑浮窗头部展示（原型 704–708）。 */
const folderPathById = computed(() => {
  const map = new Map<string, string>();
  const walk = (nodes: FolderTreeNode[], trail: string[]): void => {
    for (const node of nodes) {
      const path = [...trail, node.name];
      map.set(node.id, path.join(" / "));
      walk(node.children ?? [], path);
    }
  };
  walk(folderTree.value, []);
  return map;
});

// 成员树为完整团队树：URL 里的 folder 若不在树中，回退到「全部任务夹」（08 §2.1）。
watch([() => foldersQuery.data.value, selectedFolderId], ([tree]) => {
  if (!isShareScope.value || !tree) return;
  const folderId = selectedFolderId.value;
  if (folderId === null || folderNameById.value.has(folderId)) return;
  const query = { ...route.query };
  delete query.folder;
  void router.replace({ query });
});

// D8（原型 993 `selFolder = 'f1'`）：管理端无 folder query 时默认选中首个根夹；
// 树为空（空库）或成员域不适用，保留引导空态。
watch(folderTree, (tree) => {
  if (!isAdmin.value || tree.length === 0) return;
  if (selectedFolderId.value !== null || route.query.folder !== undefined) return;
  void router.replace({ query: { ...route.query, folder: tree[0]!.id } });
});

const taskItems = computed(() => accumulated.value);
const showLoadMore = computed(() => isShareScope.value && nextCursor.value !== null);
const taskErrorIsAuth = computed(() => isShareScope.value && isShareUnauthorized(tasksQuery.error.value));
const showTaskError = computed(() => canLoadTasks.value && tasksQuery.isError.value && !taskErrorIsAuth.value);
/**
 * 续页（cursor）失败：列表已有内容时错误不再落到首屏错误态，单独给一行可见提示（§6.2）。
 * 触发场景是管理员并发编辑/删除导致游标失效（400）或网络/5xx。
 */
const showLoadMoreError = computed(
  () => isShareScope.value && pageCursor.value !== null && tasksQuery.isError.value && !taskErrorIsAuth.value,
);

/** D18（原型 1196）：列表空态为纯文本行，管理端提示新建，成员端说明只读。 */
const emptyTip = computed(() => {
  if (isShareScope.value) return "当前范围内没有任务；成员视图为只读。";
  if (ownerFilter.value.length > 0) return "没有同时满足负责人、重要度和搜索条件的任务。调整筛选条件后再试。";
  return "当前条件下没有任务。点击工具栏「＋ 新建任务」创建第一条任务。";
});

const selectedOwnerIds = computed(() => new Set(ownerFilter.value));

function toCardModel(task: Task): TaskCardModel {
  return {
    id: task.id,
    description: task.description,
    // R3-D2（原型 1201 `from !== selName ? from : null`）：直选夹即任务直属夹时不渲染来源夹标签，
    // 只有跨夹（父夹含子夹任务）时才标注来源。
    folderName: task.folderId === selectedFolderId.value ? undefined : folderNameById.value.get(task.folderId),
    owners: task.owners,
    importance: task.importance,
    dueDate: task.dueDate,
    progress: task.progress,
    detail: task.detail,
    subtasksFiltered:
      isAdmin.value &&
      ownerFilter.value.length > 0 &&
      !task.owners.some((owner) => selectedOwnerIds.value.has(owner.id)),
    subtasks: task.subtasks.map((sub) => ({
      id: sub.id,
      description: sub.description,
      progress: sub.progress,
      ownerName: sub.owner?.name,
      ownerColor: sub.owner?.color,
    })),
  };
}

function loadMore(): void {
  if (!isShareScope.value || nextCursor.value === null) return;
  pageCursor.value = nextCursor.value;
}

/** 续页失败后重试当前 cursor 查询：保留已加载的页，不清空 accumulated（§6.2）。 */
function retryLoadMore(): void {
  if (pageCursor.value === null) return;
  void tasksQuery.refetch();
}

const editorOpen = ref(false);
const editorTask = ref<Task | null>(null);
const detailOpen = ref(false);
const detailTaskId = ref<string | null>(null);
const toast = useToast();

/** 负责人筛选只命中子任务时，列表 DTO 是裁剪后的子集，编辑前必须取完整聚合。 */
function needsFullAggregate(task: Task): boolean {
  return isAdmin.value && ownerFilter.value.length > 0 && !task.owners.some((owner) => ownerFilter.value.includes(owner.id));
}

async function openEditor(task: Task): Promise<void> {
  if (!needsFullAggregate(task)) {
    editorTask.value = task;
    editorOpen.value = true;
    return;
  }
  try {
    const detail = await adminTaskApi.get(task.id);
    editorTask.value = "task" in detail ? detail.parent : detail;
    editorOpen.value = true;
  } catch (cause) {
    // 绝不把裁剪后的子集当完整聚合打开并保存。
    toast.show(describeApiError(cause, "任务加载失败"));
  }
}

function openEditorById(taskId: string): void {
  if (!isAdmin.value) return;
  const task = accumulated.value.find((item) => item.id === taskId);
  if (task) void openEditor(task);
}

/**
 * 树内任务行 / 看板任务行点击（原型 1074–1076）：打开编辑浮窗；树和看板 DTO 只有轻量字段，
 * 不在当前列表（如未选其所在夹）时按 id 拉取完整聚合再开（D2）。
 */
async function openTaskById(taskId: string): Promise<void> {
  if (!isAdmin.value) {
    openTaskDetail(taskId);
    return;
  }
  const local = accumulated.value.find((item) => item.id === taskId);
  if (local) {
    void openEditor(local);
    return;
  }
  try {
    const detail = await adminTaskApi.get(taskId);
    // 树/看板只列主任务；若 id 命中小任务（数据竞争），退回其父任务。
    const task = "task" in detail ? detail.parent : detail;
    await openEditor(task);
  } catch {
    // 拉取失败（已删除/网络）不打断浏览：左侧列表仍是事实来源。
  }
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

/**
 * 树头「＋ 新建任务夹」：原型 1127–1128 点击后把行内输入挂到当前选中夹的子层
 * （`folderInputParent = selFolder`），按钮本身保留；行内输入由 FolderTree/FolderTreeNode 渲染。
 * 选中夹不在可见树里（URL 残留旧 id / 树仍在加载）时退化为树根行，避免入口点了没反应。
 */
const creatingFolder = ref(false);
const creatingFolderParent = ref<string | null>(null);

function startCreateFolder(): void {
  if (!isAdmin.value) return;
  const folderId = selectedFolderId.value;
  creatingFolderParent.value = folderId !== null && folderNameById.value.has(folderId) ? folderId : null;
  creatingFolder.value = true;
}

function closeCreateFolder(): void {
  creatingFolder.value = false;
  creatingFolderParent.value = null;
}
</script>

<template>
  <div class="tracker">
    <aside ref="treeSide" class="tree-side" :style="{ width: `${treeWidth}px` }">
      <div class="tree-head">
        <h2>任务夹</h2>
        <!-- D19（原型 599–602）：新建入口在树头标题右侧；点击后行内输入落在选中夹子层（原型 1120–1128）。 -->
        <button v-if="isAdmin" class="tree-create-btn" type="button" @click="startCreateFolder">＋ 新建任务夹</button>
      </div>
      <div class="tree-body">
        <FolderTree
          :scope="scopePrefix"
          :creating="creatingFolder"
          :create-parent-id="creatingFolderParent"
          @open-task="openTaskById"
          @close-create="closeCreateFolder"
        />
      </div>
    </aside>

    <PaneResizer
      v-model="treeWidth"
      label="调整任务树宽度"
      :min="220"
      :max="480"
      :step="16"
      class="tree-resizer"
      @drag="onTreeDrag"
    />

    <main class="board">
      <div class="board-head">
        <div class="crumb">
          <span class="path">{{ selectedFolderId ? folderNameById.get(selectedFolderId) ?? "选中任务夹" : "全部任务夹" }}</span>
          <span v-if="canLoadTasks" class="cnt">{{ taskItems.length }} 个任务</span>
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
          <span v-if="!isAdmin" class="ro-tag">只读视图 · 团队全部事项</span>
          <span class="spacer" />
          <span class="flabel">重要度</span>
          <button
            v-for="level in ['all', 'high', 'mid', 'low'] as const"
            :key="level"
            type="button"
            :class="importanceFilter === level ? 'fchip active' : 'fchip'"
            @click="importanceFilter = level"
          >{{ level === "all" ? "全部" : level === "high" ? "高" : level === "mid" ? "中" : "低" }}</button>
          <template v-if="isAdmin">
            <span class="flabel">负责人</span>
            <AssigneeFilter v-model="ownerFilter" :members="activeMembers" aria-label="按负责人筛选" />
          </template>
          <input v-model="searchText" class="search-box" type="search" placeholder="搜索任务描述…" aria-label="搜索任务描述">
        </div>

        <LoadingState v-if="canLoadTasks && tasksQuery.isLoading.value" label="任务加载中…" />
        <ErrorState
          v-else-if="showTaskError && taskItems.length === 0"
          message="任务加载失败"
          retryable
          @retry="tasksQuery.refetch()"
        />
        <div v-else-if="!canLoadTasks" class="empty-tip">在左侧任务夹树中选择一个任务夹以查看任务。</div>
        <div v-else class="task-list">
          <TaskCard v-for="task in taskItems" :key="task.id" :task="toCardModel(task)" @open="onTaskOpen" />
          <div
            v-if="taskItems.length === 0 && !tasksQuery.isFetching.value"
            class="empty-tip"
          >{{ emptyTip }}</div>
          <button
            v-if="showLoadMore"
            class="btn load-more"
            type="button"
            :disabled="tasksQuery.isFetching.value"
            @click="loadMore"
          >{{ tasksQuery.isFetching.value ? "加载中…" : "加载更多" }}</button>
          <div v-if="showLoadMoreError" class="load-more-error" role="alert">
            <span>加载更多失败</span>
            <button class="btn" type="button" :disabled="tasksQuery.isFetching.value" @click="retryLoadMore">重试</button>
          </div>
        </div>
        <p class="hint-line">
          {{ isAdmin ? "任务进展为只读视图；点击任务卡可在浮窗中查看或编辑完整任务。" : "成员视图为只读；点击任务可查看完整详情。" }}
        </p>
      </div>

      <div v-else class="board-body">
        <DashboardPanel
          :access="isShareScope ? 'share' : 'admin'"
          :folder-id="selectedFolderId"
          @open-task="openTaskById"
        />
      </div>
    </main>

    <TaskEditorDialog
      v-if="isAdmin"
      :open="editorOpen"
      :folder-id="selectedFolderId"
      :task="editorTask"
      :members="activeMembers"
      :folders="folderTree"
      :folder-path="editorTask ? folderPathById.get(editorTask.folderId) : undefined"
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
/* 原型 136：tracker 高度扣除 52px appbar。 */
.tracker {
  display: flex;
  align-items: stretch;
  height: calc(100vh - 52px);
  overflow: hidden;
}

.tree-side {
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  min-width: 220px;
  max-width: 480px;
}

/* 原型 144–147：标题行右侧「＋ 新建任务夹」，无下边框。 */
.tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 12px 14px 8px;
}

.tree-head h2 {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}

/* 原型 146–147/599–602：11.5px 蓝字、无边框、hover 浅蓝底（新建行已移入树内，按钮常驻）。 */
.tree-create-btn {
  font: inherit;
  font-size: 11.5px;
  color: var(--blue);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  white-space: nowrap;
}

.tree-create-btn:hover {
  background: color-mix(in srgb, var(--blue) 10%, transparent);
}

.tree-body {
  padding: 2px 8px 14px;
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

/* 原型 177：白底头部、12/20/0 内距、1px 下边框。 */
.board-head {
  padding: 12px 20px 0;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}

/* 原型 178–181：crumb 一行；计数 mono；scope-hint 右对齐。 */
.crumb {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  min-width: 0;
}

.path {
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cnt {
  font-size: 11.5px;
  color: var(--text-faint);
  font-family: var(--mono);
  flex: none;
}

.scope-hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-faint);
  flex: none;
}

/* 原型 182–188：tabs 在 crumb 下一行，13px、7/16/9 内距、active 650。 */
.tabs {
  display: flex;
  gap: 4px;
}

.tabs button {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--text-dim);
  padding: 7px 16px 9px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}

.tabs button:hover {
  color: var(--text);
}

.tabs button.active {
  color: var(--blue);
  font-weight: 650;
  border-bottom-color: var(--blue);
}

/* 原型 189：16/20/40 内距。 */
.board-body {
  padding: 16px 20px 40px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 原型 192：工具栏 12px 下距、8px 间距、可换行。 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}

.toolbar .spacer {
  flex: 1;
}

.flabel {
  font-size: 11px;
  color: var(--text-faint);
}

/* 原型 199–201：11.5px 胶囊筛选。 */
.fchip {
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 11px;
  cursor: pointer;
}

.fchip:hover {
  border-color: var(--border-strong);
}

.fchip.active {
  color: var(--blue);
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 9%, transparent);
  font-weight: 600;
}

/* 原型 202：170px 宽搜索框。 */
.search-box {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 5px 10px;
  width: 170px;
  background: var(--bg-card);
  color: var(--text);
  outline: none;
}

.search-box:focus {
  border-color: var(--blue);
}

.ro-tag {
  font-size: 11px;
  color: var(--text-faint);
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
  padding: 3px 10px;
}

/* 原型 257：键位提示行。 */
.hint-line {
  font-size: 11px;
  color: var(--text-faint);
  margin: 10px 2px 0;
}

/* 原型 193–195：主按钮 12.5px/600、radius 8、6/14 内距。 */
.btn {
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  border: 1px solid transparent;
  background: var(--bg-card);
  color: var(--text);
}

.btn.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.btn.primary:hover {
  background: #2a63c8;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* 原型 205：任务列表 14px 间距。 */
.task-list {
  display: grid;
  gap: 14px;
}

.load-more {
  align-self: center;
}

/* 续页失败：列表保留，错误行紧跟「加载更多」按钮，重试不清空已加载的页（§6.2）。 */
.load-more-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 12px;
  color: var(--red);
}

/* D18（原型 1196）：空态纯文本行。原型 .empty-tip 无任何 CSS 规则（1057/1196 行仅使用），
 * 即继承正文 13px/--text；web 早前的 12px 灰字属弱化，回归普通正文行（R3-D1，仅保留内距）。 */
.empty-tip {
  padding: 16px 4px;
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
