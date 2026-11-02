<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useRoute, useRouter } from "vue-router";
import type { FolderTreeNode } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";

/**
 * 递归树节点（08 §2.2）：行 click 选择（写 URL folder）、chevron 折叠、
 * 双击行内重命名（仅管理员）；树 DTO 来自服务端，不递归请求。
 */
const props = defineProps<{
  node: FolderTreeNode;
  depth: number;
  canEdit?: boolean;
}>();

const route = useRoute();
const router = useRouter();
const queryClient = useQueryClient();
const toast = useToast();

const collapsed = ref(false);
const renaming = ref(false);
const renameValue = ref("");

const isSelected = computed(() => route.query.folder === props.node.id);

function select(): void {
  void router.replace({ query: { ...route.query, folder: props.node.id } });
}

const renameMutation = useMutation({
  mutationFn: (input: { id: string; name: string }) => adminApi.renameFolder(input.id, input.name),
  onSuccess: () => {
    renaming.value = false;
    void queryClient.invalidateQueries({ queryKey: ["admin", "folders"] });
    toast.show("已重命名任务夹");
  },
  onError: (cause: unknown) => {
    toast.show(cause instanceof Error ? cause.message : "重命名失败");
  },
});

function submitRename(): void {
  const name = renameValue.value.trim();
  if (!name || renameMutation.isPending.value) return;
  renameMutation.mutate({ id: props.node.id, name });
}

</script>

<template>
  <li class="tree-node" role="treeitem" :aria-expanded="node.children.length ? String(!collapsed) : undefined">
    <div class="row" :class="{ selected: isSelected }" :style="{ paddingLeft: depth * 14 + 'px' }">
      <button
        v-if="node.children.length"
        class="chevron"
        type="button"
        :aria-label="(collapsed ? '展开' : '折叠') + node.name"
        @click.stop="collapsed = !collapsed"
      >
        {{ collapsed ? "▸" : "▾" }}
      </button>
      <span v-else class="chevron chevron-spacer" aria-hidden="true" />
      <button
        class="name"
        type="button"
        :title="node.name"
        @click="select"
        @dblclick="canEdit ? ((renaming = true), (renameValue = node.name)) : undefined"
      >
        {{ node.name }}
      </button>
      <span v-if="node.children.length + node.tasks.length > 0" class="counts">
        {{ node.counts.done }}/{{ node.counts.done + node.counts.todo }}
      </span>
    </div>
    <input
      v-if="renaming"
      v-model="renameValue"
      class="rename-input"
      aria-label="重命名任务夹"
      @keydown.enter="submitRename"
      @keydown.escape="renaming = false"
    >
    <ul v-if="!collapsed" class="children" role="group">
      <FolderTreeNode
        v-for="child in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :can-edit="canEdit"
      />
    </ul>
  </li>
</template>

<style scoped>
.tree-node {
  list-style: none;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 7px;
  cursor: pointer;
}

.row:hover {
  background: var(--bg-inset);
}

.row.selected {
  background: color-mix(in srgb, var(--blue) 10%, var(--bg-panel));
}

.row.selected .name {
  color: var(--blue);
  font-weight: 600;
}

.chevron {
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--text-faint);
  font-size: 10px;
  cursor: pointer;
  padding: 0;
  flex: none;
}

.chevron-spacer {
  cursor: default;
}

.name {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  color: var(--text);
  padding: 1px 4px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1;
}

.counts {
  font-size: 10.5px;
  color: var(--text-faint);
  font-family: var(--mono);
  flex: none;
}

.rename-input {
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--blue);
  border-radius: 6px;
  padding: 2px 6px;
  width: calc(100% - 20px);
  margin: 2px 0 2px 20px;
  background: var(--bg-card);
  color: var(--text);
}
</style>
