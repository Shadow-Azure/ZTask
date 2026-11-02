<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useQuery } from "@tanstack/vue-query";
import type { AdminMember, Task } from "@ztask/shared";
import { adminApi, adminTaskApi } from "../api/admin";
import TaskCard from "../components/TaskCard.vue";
import TaskEditorDialog from "../features/tasks/TaskEditorDialog.vue";
import LoadingState from "../components/ui/LoadingState.vue";
import PaneResizer from "../components/ui/PaneResizer.vue";
import EmptyState from "../components/ui/EmptyState.vue";
import FolderTree from "../features/folders/FolderTree.vue";
import { readPreference, writePreference } from "../lib/preferences";

/**
 * 事项跟踪页（管理端与成员只读共用，access=readonly 强制只读）。
 * 本 issue 只落结构与交互骨架：树/列表/看板数据由后续 issue 接入 API。
 */
const props = defineProps<{ access?: "admin" | "readonly" }>();

const route = useRoute();
const router = useRouter();

const isAdmin = computed(() => props.access !== "readonly");
const treeWidth = ref(readPreference("treeWidth") ?? 340);

watch(
  treeWidth,
  (value) => {
    writePreference("treeWidth", value);
  },
);

const activeTab = computed<"tasks" | "dash">(() => (route.query.tab === "dash" ? "dash" : "tasks"));

function switchTab(tab: "tasks" | "dash"): void {
  void router.replace({ query: { ...route.query, tab } });
}

const selectedFolderId = computed(() => (typeof route.query.folder === "string" && route.query.folder ? route.query.folder : null));

const tasksQuery = useQuery({
  queryKey: ["admin", "tasks", selectedFolderId],
  queryFn: () => adminTaskApi.list({ folderId: selectedFolderId.value ?? "", includeDescendants: true }),
  enabled: computed(() => selectedFolderId.value !== null),
  refetchInterval: 15_000,
});

const editorOpen = ref(false);
const editorTask = ref<Task | null>(null);

function openEditor(task: Task): void {
  editorTask.value = task;
  editorOpen.value = true;
}

function openEditorById(taskId: string): void {
  const task = tasksQuery.data.value?.items.find((item) => item.id === taskId);
  if (task) openEditor(task);
}

function openCreate(): void {
  editorTask.value = null;
  editorOpen.value = true;
}

function onSaved(): void {
  void tasksQuery.refetch();
}

const importanceFilter = ref<"all" | "high" | "mid" | "low">("all");
const searchText = ref("");

const visibleTasks = computed(() => {
  const items = tasksQuery.data.value?.items ?? [];
  return items.filter((task) => {
    if (importanceFilter.value !== "all" && task.importance !== importanceFilter.value) return false;
    if (searchText.value && !task.description.includes(searchText.value)) return false;
    return true;
  });
});

function localFilterClasses(level: "all" | "high" | "mid" | "low"): string {
  return importanceFilter.value === level ? "fchip active" : "fchip";
}

const membersQuery = useQuery({
  queryKey: ["admin", "members"],
  queryFn: adminApi.members,
  refetchInterval: 30_000,
});

const activeMembers = computed<AdminMember[]>(() =>
  (membersQuery.data.value?.items ?? []).filter((member) => member.archivedAt === null),
);
</script>

<template>
  <div class="tracker" :class="{ narrow: false }">
    <aside class="tree-side" :style="{ width: `${treeWidth}px` }">
      <div class="tree-head">
        <h2>任务夹</h2>
      </div>
      <div class="tree-body">
        <FolderTree :can-edit="isAdmin" />
      </div>
    </aside>

    <PaneResizer
      v-model="treeWidth"
      label="调整任务树宽度"
      :min="220"
      :max="480"
      class="tree-resizer"
    />

    <main class="board">
      <div class="board-head">
        <div class="crumb">
          <span class="path">{{ selectedFolderId ? "选中任务夹" : "全部任务夹" }}</span>
          <span class="scope-hint">包含子任务夹中的全部任务</span>
        </div>
        <div class="tabs" role="tablist" aria-label="事项跟踪视图">
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'tasks'"
            :class="{ active: activeTab === 'tasks' }"
            @click="switchTab('tasks')"
          >
            任务管理
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="activeTab === 'dash'"
            :class="{ active: activeTab === 'dash' }"
            @click="switchTab('dash')"
          >
            情况看板
          </button>
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
            :class="localFilterClasses(level)"
            @click="importanceFilter = level"
          >{{ level === "all" ? "全部" : level === "high" ? "高" : level === "mid" ? "中" : "低" }}</button>
          <input v-model="searchText" class="search-box" type="search" placeholder="搜索任务描述…" aria-label="搜索任务描述">
        </div>

        <LoadingState v-if="tasksQuery.isLoading.value && selectedFolderId" label="任务加载中…" />
        <div v-else-if="selectedFolderId" class="task-list">
          <TaskCard v-for="task in visibleTasks" :key="task.id" :task="task" @open="openEditorById" />
          <EmptyState v-if="visibleTasks.length === 0" title="暂无任务" hint="点击「＋ 新建任务」创建第一个任务" />
        </div>
        <EmptyState v-else title="先选择任务夹" hint="在左侧任务夹树中选择一个任务夹以查看任务" />
        <p class="hint-line">任务进展为只读视图；点击任务标题区可在浮窗中查看或编辑完整任务。</p>
      </div>

      <div v-else class="board-body">
        <EmptyState hint="情况看板统计与历史变化将在 m5 接入" />
      </div>

    <TaskEditorDialog
      :open="editorOpen"
      :folder-id="selectedFolderId"
      :task="editorTask"
      :members="activeMembers"
      @close="editorOpen = false"
      @saved="onSaved"
    />
    </main>
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

.btn.ghost {
  border-color: transparent;
  color: var(--text-dim);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
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
