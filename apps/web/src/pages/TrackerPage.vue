<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import PaneResizer from "../components/ui/PaneResizer.vue";
import EmptyState from "../components/ui/EmptyState.vue";
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
</script>

<template>
  <div class="tracker" :class="{ narrow: false }">
    <aside class="tree-side" :style="{ width: `${treeWidth}px` }">
      <div class="tree-head">
        <h2>任务夹</h2>
        <button v-if="isAdmin" class="btn ghost" type="button" disabled title="任务夹数据在后续里程碑接入">＋ 新建任务夹</button>
      </div>
      <div class="tree-body">
        <EmptyState hint="任务夹与任务树将在 m3 接入真实数据" />
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
          <span class="path">全部任务夹</span>
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
          <button v-if="isAdmin" class="btn primary" type="button" disabled title="任务数据在后续里程碑接入">＋ 新建任务</button>
          <span v-else class="ro-tag">只读视图 · 数据来自你有权查看的范围</span>
          <span class="spacer" />
          <span class="flabel">重要度</span>
          <button class="fchip active" type="button">全部</button>
          <button class="fchip" type="button">高</button>
          <button class="fchip" type="button">中</button>
          <button class="fchip" type="button">低</button>
          <input class="search-box" type="search" placeholder="搜索任务描述…" :disabled="!isAdmin" aria-label="搜索任务描述">
        </div>
        <EmptyState hint="任务列表将在 m3 接入真实数据；此处为设计系统占位" />
        <p class="hint-line">任务进展为只读视图；点击任务标题区可在浮窗中查看或编辑完整任务。</p>
      </div>

      <div v-else class="board-body">
        <EmptyState hint="情况看板统计与历史变化将在 m5 接入" />
      </div>
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
