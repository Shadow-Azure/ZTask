<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { adminApi } from "../../api/admin";
import { shareApi } from "../../api/share";
import { useToast } from "../../components/ui/toast";
import EmptyState from "../../components/ui/EmptyState.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import FolderTreeNode from "./FolderTreeNode.vue";

/**
 * 任务夹树容器（08 §2.2、05 §6.11）：按数据域取树 + 管理员"＋ 新建任务夹"行内创建。
 * scope=share 时使用成员只读树（只含相关任务及祖先）且不渲染新建行；
 * 创建位置 = 当前选中夹（URL folder），无选中则在根。
 */
const props = defineProps<{
  canEdit?: boolean;
  /** 数据域：share 走成员只读 API，query key 一并按域隔离（08 §6.3）。 */
  scope?: "admin" | "share";
}>();

const route = useRoute();
const queryClient = useQueryClient();
const toast = useToast();

const isShareScope = computed(() => props.scope === "share");
const scopePrefix = computed(() => (isShareScope.value ? "share" : "admin"));
/** 只读域（成员壳）永不渲染新建任务夹行，即使父级误传 canEdit。 */
const canCreate = computed(() => props.canEdit === true && !isShareScope.value);

const treeQuery = useQuery({
  queryKey: [scopePrefix.value, "folders", "tree"],
  queryFn: () => (isShareScope.value ? shareApi.foldersTree() : adminApi.folderTree()),
  refetchInterval: 15_000,
});

const creating = ref(false);
const newName = ref("");

const createMutation = useMutation({
  mutationFn: (input: { name: string; parentId: string | null }) => adminApi.createFolder(input),
  onSuccess: (folder) => {
    newName.value = "";
    creating.value = false;
    void queryClient.invalidateQueries({ queryKey: ["admin", "folders"] });
    toast.show(`已创建任务夹「${folder.name}」`);
  },
  onError: (cause: unknown) => {
    toast.show(cause instanceof Error ? cause.message : "创建失败");
  },
});

function submitCreate(): void {
  if (!canCreate.value) return;
  const name = newName.value.trim();
  if (!name || createMutation.isPending.value) return;
  const parentId = typeof route.query.folder === "string" && route.query.folder ? route.query.folder : null;
  createMutation.mutate({ name, parentId });
}

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

    <div v-if="canCreate" class="create-row">
      <template v-if="creating">
        <input
          v-model="newName"
          class="create-input"
          placeholder="任务夹名称，回车确认…"
          aria-label="新任务夹名称"
          @keydown.enter="submitCreate"
          @keydown.escape="creating = false"
        >
        <button class="btn ghost" type="button" @click="creating = false">取消</button>
      </template>
      <button v-else class="btn ghost create-btn" type="button" @click="creating = true">＋ 新建任务夹</button>
    </div>
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

.create-row {
  display: flex;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.create-input {
  font: inherit;
  font-size: 12px;
  flex: 1;
  min-width: 0;
  border: 1px solid var(--blue);
  border-radius: 6px;
  padding: 4px 8px;
  background: var(--bg-card);
  color: var(--text);
}

.btn {
  font: inherit;
  font-size: 12px;
  border-radius: 7px;
  padding: 4px 10px;
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-dim);
}

.btn:hover {
  background: var(--bg-inset);
  color: var(--text);
}
</style>
