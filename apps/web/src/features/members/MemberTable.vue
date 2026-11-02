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
import ShareLinkCell from "./ShareLinkCell.vue";

/**
 * 成员表格（08 §5，原型 mem-table）：列表 15s 轮询；
 * 添加/编辑浮窗 + 归档确认（含影响说明）；分享链接列由 ShareLinkCell 承载脱敏态，
 * 生成/重置后的完整 URL 只在表格下方的受控结果区展示（刷新后不可恢复）。
 */
const queryClient = useQueryClient();
const toast = useToast();

const emit = defineEmits<{
  /** 分享链接操作发现 LAN 未开启：交给 MembersPage 聚焦网络面板。 */
  "needs-network": [];
}>();

/** 受控结果区：只保存「本次会话刚生成/重置」的完整 URL，刷新即消失。 */
const issued = ref<{ memberId: string; memberName: string; url: string } | null>(null);
const copyFailed = ref(false);
const copied = ref(false);

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

/**
 * 接管 ShareLinkCell 刚拿到的完整 URL（08 §5 受控结果区）。
 * @param payload 成员与本次生成/重置的 url。
 */
function handleIssued(payload: { member: AdminMember; url: string }): void {
  issued.value = { memberId: payload.member.id, memberName: payload.member.name, url: payload.url };
  copied.value = false;
  copyFailed.value = false;
}

/**
 * 吊销后清掉该成员的结果区，避免残留已失效的链接。
 * @param memberId 被吊销的成员。
 */
function handleCleared(memberId: string): void {
  if (issued.value?.memberId === memberId) issued.value = null;
}

/**
 * 复制受控结果区的完整 URL；失败时不假装成功，提示手动选中复制。
 */
async function copyIssued(): Promise<void> {
  const url = issued.value?.url;
  if (!url) return;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(url);
    copied.value = true;
    copyFailed.value = false;
    toast.show("链接已复制，请只发给该成员");
  } catch {
    copied.value = false;
    copyFailed.value = true;
    toast.show("复制失败，请手动选中链接复制");
  }
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
          <td class="link-cell">
            <ShareLinkCell
              v-if="!member.archivedAt"
              :member="member"
              @issued="handleIssued"
              @cleared="handleCleared"
              @needs-network="emit('needs-network')"
            />
            <span v-else class="link-none">已归档</span>
          </td>
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

    <!-- 受控结果区（08 §5）：完整 URL 只在本次生成/重置后可见，刷新即不可恢复。 -->
    <div v-if="issued" class="link-result">
      <div class="link-result-head">
        <span class="link-result-title">「{{ issued.memberName }}」的新链接</span>
        <code class="link-url" :title="issued.url">{{ issued.url }}</code>
        <button class="mini-btn blue link-copy" type="button" @click="copyIssued">
          {{ copied ? "已复制" : "复制" }}
        </button>
      </div>
      <p class="link-warning">
        链接包含访问凭证，请只发给该成员；刷新后无法再次查看，只能重置。
      </p>
      <p v-if="copyFailed" class="link-copy-failed">复制失败，请选中上面的链接手动复制。</p>
    </div>

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

.link-cell {
  min-width: 300px;
}

.link-none {
  font-size: 11.5px;
  color: var(--text-faint);
}

.link-result {
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.link-result-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.link-result-title {
  font-size: 12px;
  font-weight: 500;
}

.link-url {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 8px;
  max-width: 420px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: all;
}

.link-warning {
  margin-top: 6px;
  font-size: 11px;
  color: var(--orange);
}

.link-copy-failed {
  margin-top: 4px;
  font-size: 11px;
  color: var(--red);
}

.mini-btn {
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  padding: 2.5px 9px;
  cursor: pointer;
  white-space: nowrap;
}

.mini-btn.blue {
  color: var(--blue);
  border-color: color-mix(in srgb, var(--blue) 45%, transparent);
}

.mini-btn.blue:hover {
  background: color-mix(in srgb, var(--blue) 8%, transparent);
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
  /* 分享链接在 #20 起是真实操作列（原型在窄屏也保留），窄屏只收窄不隐藏；
     ShareLinkCell 自身 flex-wrap，状态与按钮会自然换行。 */
  .link-cell {
    min-width: 0;
  }

  .col-member {
    width: auto;
  }
}
</style>
