<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { adminApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import FolderTreeNode from "./FolderTreeNode.vue";
import FolderTreeCreateRow from "./FolderTreeCreateRow.vue";

/**
 * 任务夹树容器（08 §2.2、05 §6.11、原型 1054–1125）：按数据域取树并递归渲染。
 * 空态为原型式纯文本（.empty-tip，D18）。「＋ 新建任务夹」入口由 TrackerView 的树头承载（D19），
 * 点击后行内输入渲染在选中夹的 `.tchildren` 末尾（原型 1120–1121，状态由 TrackerView 持有并向下传递）；
 * 管理端未选中夹（树为空 / 加载中，原型恒有选中夹）时退化为树根新建行，保留建首个夹的能力。
 * scope=share 时树为完整团队树（含空夹），且不含任何写入口。
 * 任务行 open-task 事件向上转发给 TrackerView（管理端开编辑浮窗 / 成员端开只读详情）。
 */
const props = defineProps<{
  canEdit?: boolean;
  /** 数据域：share 走成员只读 API，query key 一并按域隔离（08 §6.3）。 */
  scope?: "admin" | "share";
  /** 是否处于树内新建任务夹态。 */
  creating?: boolean;
  /** 新建行的父夹 id；null 时落在树根。 */
  createParentId?: string | null;
}>();

interface TreeContextMenuTarget {
  kind: "folder" | "task";
  id: string;
  folderId: string;
  name: string;
  x: number;
  y: number;
}

const emit = defineEmits<{
  "open-task": [taskId: string];
  "close-create": [];
  "context-menu": [target: TreeContextMenuTarget];
}>();

const isShareScope = computed(() => props.scope === "share");
const scopePrefix = computed(() => (isShareScope.value ? "share" : "admin"));

const treeQuery = useQuery({
  queryKey: [scopePrefix.value, "folders", "tree"],
  queryFn: () => (isShareScope.value ? shareApi.foldersTree() : adminApi.folderTree()),
  refetchInterval: 15_000,
});

const tree = computed(() => treeQuery.data.value?.tree ?? []);
const hasFolders = computed(() => tree.value.length > 0);
/** 原型 1057：树空态纯文本。 */
const emptyText = computed(() =>
  isShareScope.value ? "当前范围内没有可见的任务夹（只读）。" : "还没有任务夹。点击右上角「＋ 新建任务夹」开始。",
);

defineExpose({ treeQuery });
</script>

<template>
  <div class="folder-tree">
    <LoadingState v-if="treeQuery.isLoading.value" label="任务夹加载中…" />
    <ErrorState
      v-else-if="treeQuery.isError.value"
      message="任务夹加载失败"
      retryable
      @retry="treeQuery.refetch()"
    />
    <div v-else-if="!hasFolders" class="empty-tip">{{ emptyText }}</div>
    <ul v-else class="tree-root" role="tree" aria-label="任务夹">
      <FolderTreeNode
        v-for="node in tree"
        :key="node.id"
        :node="node"
        :depth="0"
        :can-edit="canEdit"
        :creating="creating"
        :create-parent-id="createParentId"
        @open-task="(taskId: string) => emit('open-task', taskId)"
        @close-create="emit('close-create')"
        @context-menu="(target) => emit('context-menu', target)"
      />
    </ul>
    <!-- web 独有态：无选中夹（树为空或加载中）时新建行退化为树根行，避免失去建首个夹的能力。 -->
    <ul v-if="creating && createParentId === null" class="tree-root root-create" aria-label="在树根新建任务夹">
      <FolderTreeCreateRow :parent-id="null" @close="emit('close-create')" />
    </ul>
  </div>
</template>

<style scoped>
.folder-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tree-root {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* 原型 1196：空态纯文本行。原型 .empty-tip 无 CSS 规则，字号/字色继承正文（R3-D1，仅保留内距）。 */
.empty-tip {
  padding: 16px 4px;
}
</style>
