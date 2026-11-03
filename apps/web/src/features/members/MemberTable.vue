<script setup lang="ts">
import { computed, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";
import BaseDialog from "../../components/ui/BaseDialog.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";
import MemberEditorDialog from "./MemberEditorDialog.vue";
import ShareLinkCell from "./ShareLinkCell.vue";
import { describeApiError } from "../../api/error-message";

/**
 * 成员表格（08 §5，原型 mem-table 688–694/1780–1799）：列表 15s 轮询；
 * 编辑浮窗 + 移除（软删归档）确认（含影响说明）；分享链接列由 ShareLinkCell 承载脱敏态，
 * 生成/重置后的完整 URL 只在表格下方的受控结果区展示（刷新后不可恢复）。
 * 「＋ 添加成员」按钮由 MembersPage 标题行承载（D9），本组件经 defineExpose 暴露打开方法。
 */
const queryClient = useQueryClient();
const toast = useToast();

const emit = defineEmits<{
  /** 分享链接操作发现 LAN 未开启：交给 MembersPage 聚焦网络面板。 */
  "needs-network": [];
}>();

/** 受控结果区：只保存「本次会话刚生成/重置」的完整 URL，刷新即消失。 */
const issued = ref<{ memberId: string; memberName: string; url: string } | null>(null);
const copied = ref(false);
const copyFailed = ref(false);

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

defineExpose({ openCreate });

const archiveMutation = useMutation({
  mutationFn: (id: string) => adminApi.archiveMember(id),
  onSuccess: (_data, archivedId) => {
    archiving.value = null;
    // 归档（软删）会吊销链接并清空任务分配：成员、任务树与任务列表都必须失效（08 §5）。
    if (issued.value?.memberId === archivedId) issued.value = null;
    void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "folders"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "tasks"] });
    toast.show("成员已移除；其历史任务保留并显示待分配");
  },
  onError: (cause: unknown) => {
    toast.show(describeApiError(cause, "移除失败"));
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
  return `移除成员「${member.name}」？其分享链接会立即失效，任务中的负责人/协作人标记也会被清除；${total > 0 ? `其 ${total} 项任务分配将显示为待分配，` : ""}历史任务与操作记录完整保留。`;
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
          <!-- 原型 1777：空态纯文本行。 -->
          <td colspan="6"><div class="empty-tip">还没有团队成员，点击右上角「＋ 添加成员」创建第一位成员。</div></td>
        </tr>
        <tr v-for="member in membersQuery.data.value?.items ?? []" :key="member.id" :class="{ archived: member.archivedAt }">
          <td class="col-member">
            <span class="mem-id">
              <span class="ava" :style="{ background: member.color }" aria-hidden="true">{{ member.name.slice(0, 1) }}</span>
              <span class="name">{{ member.name }}</span>
            </span>
            <span v-if="member.archivedAt" class="archived-tag">已归档</span>
          </td>
          <td class="role">{{ member.role || "—" }}</td>
          <td class="col-count count">{{ member.counts.owned }}</td>
          <td class="col-count count">{{ member.counts.collaborated }}</td>
          <td class="link-cell">
            <ShareLinkCell
              v-if="!member.archivedAt"
              :member="member"
              :issued-member-id="issued?.memberId ?? null"
              @issued="handleIssued"
              @cleared="handleCleared"
              @copy-issued="copyIssued"
              @needs-network="emit('needs-network')"
            />
            <span v-else class="link-none">已归档</span>
          </td>
          <td class="col-actions">
            <template v-if="!member.archivedAt">
              <!-- 原型 1796–1797：描边 mini-btn「编辑」+ 红字「移除」（软删语义见确认弹窗）。 -->
              <button class="mini-btn" type="button" @click="openEdit(member)">编辑</button>
              <button class="mini-btn red" type="button" @click="archiving = member">移除</button>
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

    <BaseDialog :open="archiving !== null" title="移除成员" @close="archiving = null">
      <p class="archive-text">{{ archiveImpact }}</p>
      <template #foot>
        <span class="sp" />
        <button class="btn ghost" type="button" @click="archiving = null">取消</button>
        <button class="btn danger-btn" type="button" :disabled="archiveMutation.isPending.value" @click="confirmArchive">
          {{ archiveMutation.isPending.value ? "移除中…" : "确认移除" }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
/* 原型 358：白底圆角表格 + 轻投影。 */
.mem-table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  font-size: 12.5px;
}

/* 原型 359：表头 11px/600、bg-panel、9/14 内距。 */
.mem-table th {
  text-align: left;
  font-size: 11px;
  color: var(--text-faint);
  font-weight: 600;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

/* 原型 360–362：10/14 内距、行分隔 #eef1f5、hover #f7f9fc。 */
.mem-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-row);
  vertical-align: middle;
}

.mem-table tr:last-child td {
  border-bottom: none;
}

.mem-table tbody tr:hover {
  background: #f7f9fc;
}

/* 原型 363：头像 + 名字 600。 */
.mem-id {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  font-weight: 600;
}

tr.archived .mem-id .name,
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
  flex: none;
}

.name {
  font-weight: 600;
}

/* 原型 1196/1777：空态纯文本行。原型 .empty-tip 无 CSS 规则 → 继承所在 td 的 12.5px/--text（R3-D1，仅保留内距）。 */
.empty-tip {
  padding: 16px 4px;
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
  font-size: 12px;
}

/* 原型 365：mono 计数。 */
.col-count {
  width: 80px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
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

/* 原型 1795–1798：操作列窄单元（活体探针 110px），同一 td 内两枚 mini-btn 自然换行成两行堆叠（D9 残余）；
   只去掉 nowrap：110px 扣除 10/14 内距后容不下两枚并排按钮（42+42+字距 ≈ 88px > 82px）。 */
.col-actions {
  width: 110px;
}

/* 原型 369–374：描边 mini-btn；red 变体红字红描边。 */
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

.mini-btn:hover {
  color: var(--text);
  background: var(--bg-inset);
}

.mini-btn.red {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 40%, transparent);
}

.mini-btn.red:hover {
  background: color-mix(in srgb, var(--red) 7%, transparent);
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
