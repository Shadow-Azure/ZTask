<script setup lang="ts">
import { ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { useRoute } from "vue-router";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";

/**
 * 管理员"＋ 新建任务夹"行（08 §2.2）：创建 mutation 与输入草稿只存在于本组件，
 * 成员只读域根本不渲染它，因此 share 作用域不会注册任何写 mutation（03 §5、08 §6.3）。
 */
const route = useRoute();
const queryClient = useQueryClient();
const toast = useToast();

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
  const name = newName.value.trim();
  if (!name || createMutation.isPending.value) return;
  const parentId = typeof route.query.folder === "string" && route.query.folder ? route.query.folder : null;
  createMutation.mutate({ name, parentId });
}
</script>

<template>
  <div class="create-row">
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
</template>

<style scoped>
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
