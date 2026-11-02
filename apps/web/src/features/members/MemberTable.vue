<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";
import BaseDialog from "../../components/ui/BaseDialog.vue";
import EmptyState from "../../components/ui/EmptyState.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import MemberEditorDialog from "./MemberEditorDialog.vue";

/**
 * 成员表格（08 §5，原型 mem-table）：列表 15s 轮询；
 * 添加/编辑浮窗 + 归档确认（含影响说明）；分享链接列 m4 前显示占位。
 */
const queryClient = useQueryClient();
const toast = useToast();

const membersQuery = useQuery({
  queryKey: ["admin", "members"],
  queryFn: adminApi.members,
  refetchInterval: 15_000,
});

const editorOpen = ref(false);
const editing = ref<AdminMember | null>(null);
const archiving = ref<AdminMember | null>(null);

function openCreate(): void {
  editing.value = null;
  editorOpen.value = true;
}

const archiveMutation = useMutation({
  mutationFn: (id: string) => adminApi.archiveMember(id),
  onSuccess: () => {
    archiving.value = null;
    void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
    toast.show("成员已归档；其历史任务保留并显示待分配");
  },
  onError: (cause: unknown) => {
    toast.show(cause instanceof Error ? cause.message : "归档失败");
  },
});

function openEdit(member: AdminMember): void {
  editing.value = member;
  editorOpen.value = true;
}

const archiveImpact = computed(() => {
  const member = archiving.value;
  if (!member) return "";
  const total = member.counts.owned + member.counts.collaborated;
  return `归档后「${member.name}」将无法访问本服务；其${total > 0 ? ` ${total} 项任务分配将显示为待分配，` : ""}历史任务与操作记录完整保留。此操作不影响已完成的历史。`;
});

function confirmArchive(): void {
  if (!archiving.value || archiveMutation.isPending.value) return;
  archiveMutation.mutate(archiving.value.id);
}
</script>

<template>
  <div class="member-table-wrap">
    <div class="table-toolbar">
      <button class="btn primary" type="button" @click="openCreate">＋ 添加成员</button>
    </div>
    <LoadingState v-if="membersQuery.isLoading.value" label="成员加载中…" />
    <ErrorState
      v-else-if="membersQuery.isError.value"
      message="成员加载失败"
      retryable
      @retry="membersQuery.refetch()"
    />
    <table v-else class="mem-table">
      <thead>
        <tr>
          <th class="col-member">成员</th>
          <th>角色</th>
          <th class="col-count">负责中</th>
          <th class="col-count">协作中</th>
          <th>分享链接（局域网）</th>
          <th class="col-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="membersQuery.data.value && membersQuery.data.value.items.length === 0">
          <td colspan="6"><EmptyState hint="点击「＋ 添加成员」建立团队" title="成员列表为空" /></td>
        </tr>
        <tr v-for="member in membersQuery.data.value?.items ?? []" :key="member.id" :class="{ archived: member.archivedAt }">
          <td class="col-member">
            <span class="ava" :style="{ background: member.color }" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
            <span class="name">{{ member.name }}</span>
            <span v-if="member.archivedAt" class="archived-tag">已归档</span>
          </td>
          <td class="role">{{ member.role || "—" }}</td>
          <td class="col-count count">{{ member.counts.owned }}</td>
          <td class="col-count count">{{ member.counts.collaborated }}</td>
          <td class="share-cell">分享链接将在 m4 接入</td>
          <td class="col-actions">
            <template v-if="!member.archivedAt">
              <button class="link-btn" type="button" @click="openEdit(member)">编辑</button>
              <button class="link-btn danger" type="button" @click="archiving = member">归档</button>
            </template>
            <span v-else class="archived-hint">—</span>
          </td>
        </tr>
      </tbody>
    </table>

    <MemberEditorDialog :open="editorOpen" :member="editing" @close="editorOpen = false" />

    <BaseDialog :open="archiving !== null" title="归档成员" @close="archiving = null">
      <p class="archive-text">{{ archiveImpact }}</p>
      <template #foot>
        <span class="sp" />
        <button class="btn ghost" type="button" @click="archiving = null">取消</button>
        <button class="btn danger-btn" type="button" :disabled="archiveMutation.isPending.value" @click="confirmArchive">
          {{ archiveMutation.isPending.value ? "归档中…" : "确认归档" }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.table-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}

.btn.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.mem-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  font-size: 12.5px;
}

.mem-table th {
  text-align: left;
  font-size: 11px;
  color: var(--text-faint);
  font-weight: 500;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.mem-table td {
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}

.mem-table tr:last-child td {
  border-bottom: none;
}

tr.archived .name,
tr.archived .role {
  color: var(--text-faint);
}

.col-member {
  width: 180px;
}

.col-member .ava {
  display: inline-flex;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  color: #fff;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  margin-right: 8px;
  vertical-align: middle;
}

.name {
  vertical-align: middle;
  font-weight: 500;
}

.archived-tag {
  font-size: 10px;
  color: var(--text-faint);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 0 7px;
  margin-left: 6px;
}

.role {
  color: var(--text-dim);
}

.col-count {
  width: 80px;
  font-family: var(--mono);
}

.share-cell {
  color: var(--text-faint);
  font-size: 11.5px;
}

.col-actions {
  width: 110px;
  white-space: nowrap;
}

.link-btn {
  border: none;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: var(--blue);
  cursor: pointer;
  padding: 2px 6px;
}

.link-btn.danger {
  color: var(--red);
}

.link-btn:hover {
  text-decoration: underline;
}

.archived-hint {
  color: var(--text-faint);
}

.archive-text {
  font-size: 12.5px;
  color: var(--text-dim);
}

.btn {
  font: inherit;
  font-size: 12.5px;
  border-radius: 7px;
  padding: 6px 14px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
}

.btn.ghost {
  border-color: transparent;
  color: var(--text-dim);
}

.btn.danger-btn {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sp {
  flex: 1;
}

@media (max-width: 900px) {
  .share-cell {
    display: none;
  }

  .mem-table th:nth-child(5) {
    display: none;
  }
}
</style>
