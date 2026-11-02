<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { adminApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import EmptyState from "../../components/ui/EmptyState.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import FolderTreeNode from "./FolderTreeNode.vue";
import FolderTreeCreateRow from "./FolderTreeCreateRow.vue";

/**
 * 任务夹树容器（08 §2.2、05 §6.11）：按数据域取树 + 管理员"＋ 新建任务夹"行内创建。
 * scope=share 时使用成员只读树（只含相关任务及祖先），且创建行（连同写 mutation）
 * 整体交给 FolderTreeCreateRow 并且不渲染，成员域因此不注册任何写 mutation。
 */
const props = defineProps<{
  canEdit?: boolean;
  /** 数据域：share 走成员只读 API，query key 一并按域隔离（08 §6.3）。 */
  scope?: "admin" | "share";
}>();

const isShareScope = computed(() => props.scope === "share");
const scopePrefix = computed(() => (isShareScope.value ? "share" : "admin"));
/** 只读域（成员壳）永不渲染新建任务夹行，即使父级误传 canEdit。 */
const canCreate = computed(() => props.canEdit === true && !isShareScope.value);

const treeQuery = useQuery({
  queryKey: [scopePrefix.value, "folders", "tree"],
  queryFn: () => (isShareScope.value ? shareApi.foldersTree() : adminApi.folderTree()),
  refetchInterval: 15_000,
});

const tree = computed(() => treeQuery.data.value?.tree ?? []);
const hasFolders = computed(() => tree.value.length > 0);

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
    <template v-else>
      <EmptyState
        v-if="!hasFolders"
        :title="canCreate ? undefined : '暂无任务夹'"
        :hint="canCreate ? '点击「＋ 新建任务夹」创建第一个任务夹' : '当前范围内没有可见的任务夹（只读）'"
      />
      <ul v-else class="tree-root" role="tree" aria-label="任务夹">
        <FolderTreeNode
          v-for="node in tree"
          :key="node.id"
          :node="node"
          :depth="0"
          :can-edit="canCreate"
        />
      </ul>
    </template>

    <FolderTreeCreateRow v-if="canCreate" />
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
  gap: 1px;
}

</style>
