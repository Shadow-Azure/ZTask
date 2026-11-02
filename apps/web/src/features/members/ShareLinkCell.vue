<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ApiError, type AdminMember, type AdminMemberShareLink, type AdminShareLinkState } from "@ztask/shared";
import { networkApi, shareLinkApi } from "../../api/network";
import { useToast } from "../../components/ui/toast";
import BaseDialog from "../../components/ui/BaseDialog.vue";

/**
 * 成员分享链接单元格（08 §5，原型 .link-cell/.link-box，ztask-prototype.html:1786–1794）：
 * 只渲染脱敏状态（member.shareLink）；raw URL 只在本次生成/重置后交给表格下方的
 * 受控结果区展示，刷新后不伪称能复制旧链接，而提示「重置后可复制」（D10 折中：
 * 行内保留原型式「复制」入口，但只在受控结果区持有本成员新链接时可用）。
 * 重置/吊销复用统一确认 Dialog；LAN 未开启时先引导网络面板，再调生成端点。
 */
const props = defineProps<{
  /** 成员行（含脱敏链接态与计数）。 */
  member: AdminMember;
  /** 受控结果区当前展示的成员；只有它能在表格里「直接复制」这次拿到的 URL。 */
  issuedMemberId: string | null;
}>();

const emit = defineEmits<{
  /** 生成/重置成功：把这一次的完整 URL 交给受控结果区。 */
  issued: [payload: { member: AdminMember; url: string }];
  /** 吊销成功：清掉该成员可能残留的旧 URL 结果区。 */
  cleared: [memberId: string];
  /** 点击行内「复制」：由父级复制受控结果区的 URL（URL 不随列表渲染进 DOM）。 */
  "copy-issued": [];
  /** LAN 未开启：父级聚焦/滚动到局域网分享面板。 */
  "needs-network": [];
}>();

const queryClient = useQueryClient();
const toast = useToast();

/**
 * 409/链路错误后用 GET share-link 一次性纠正过期列表态。
 * `undefined` = 尚未纠正；`null` = 服务端确认「从未生成」。
 * 一旦父级列表带来新事实（15s 轮询/失效重取）就清掉本地纠正，
 * 否则它（优先级更高）会永久盖住 revoked 等服务端变化。
 */
const reconciled = ref<AdminMemberShareLink | null | undefined>(undefined);
const confirmRotateOpen = ref(false);
const confirmRevokeOpen = ref(false);

/** 与 NetworkSharePanel 共用 ["admin","network"] 缓存：生成前判断 LAN 是否真的在运行。 */
const networkQuery = useQuery({
  queryKey: ["admin", "network"],
  queryFn: networkApi.network,
  refetchOnWindowFocus: true,
});

const state = computed<AdminMemberShareLink | null>(() =>
  reconciled.value !== undefined ? reconciled.value : props.member.shareLink,
);

watch(
  () => props.member.shareLink,
  () => {
    reconciled.value = undefined;
  },
);

const lastUsedText = computed(() => {
  const used = state.value?.lastUsedAt;
  return used ? `最近使用 ${formatShort(used)}` : "尚未使用";
});

const revokedText = computed(() => {
  const revoked = state.value?.revokedAt;
  return revoked ? `吊销于 ${formatShort(revoked)}` : "已吊销";
});

const busy = computed(
  () =>
    generateMutation.isPending.value || rotateMutation.isPending.value || revokeMutation.isPending.value,
);

/**
 * 把 ISO 时间渲染为原型的 `MM-DD HH:mm`（本地时区）。
 * @param iso UTC RFC 3339 时间串。
 * @returns 短格式时间；非法输入原样返回。
 */
function formatShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 统一错误面（08 §5）：LAN 未开启引导到网络面板，已有 active 链接提示改用重置，
 * 其余错误 toast；绝不把失败显示成成功。
 * @param cause useMutation 抛出的错误。
 */
function handleError(cause: unknown): void {
  if (cause instanceof ApiError && cause.code === "LAN_SHARE_DISABLED") {
    toast.show("请先开启局域网分享");
    emit("needs-network");
    return;
  }
  if (cause instanceof ApiError && cause.code === "ACTIVE_SHARE_LINK_EXISTS") {
    toast.show("该成员已有有效链接，请改用「重置」");
    void reconcile();
    return;
  }
  toast.show(cause instanceof Error ? cause.message : "链接操作失败");
}

/** 用 GET share-link 纠正本行脱敏态（成员列表 15s 轮询之外的即时兜底）。 */
async function reconcile(): Promise<void> {
  try {
    const latest: AdminShareLinkState = await shareLinkApi.shareLink(props.member.id);
    reconciled.value =
      latest.status === "none"
        ? null
        : {
            status: latest.status,
            createdAt: latest.createdAt,
            revokedAt: latest.revokedAt,
            lastUsedAt: latest.lastUsedAt,
          };
  } catch {
    // 纠正失败不覆盖错误提示：保持列表当前值，等轮询自然刷新。
  }
}

const generateMutation = useMutation({
  mutationFn: () => shareLinkApi.generateShareLink(props.member.id),
  onSuccess: (issued) => {
    toast.show(`已为「${props.member.name}」生成分享链接`);
    emit("issued", { member: props.member, url: issued.url });
    void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
  },
  onError: handleError,
});

const rotateMutation = useMutation({
  mutationFn: () => shareLinkApi.rotateShareLink(props.member.id),
  onSuccess: (issued) => {
    confirmRotateOpen.value = false;
    toast.show(`已重置「${props.member.name}」的链接，旧链接已失效`);
    emit("issued", { member: props.member, url: issued.url });
    void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
  },
  onError: (cause: unknown) => {
    confirmRotateOpen.value = false;
    handleError(cause);
  },
});

const revokeMutation = useMutation({
  mutationFn: () => shareLinkApi.revokeShareLink(props.member.id),
  onSuccess: () => {
    confirmRevokeOpen.value = false;
    toast.show(`已吊销「${props.member.name}」的链接`);
    emit("cleared", props.member.id);
    void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
  },
  onError: (cause: unknown) => {
    confirmRevokeOpen.value = false;
    handleError(cause);
  },
});

/**
 * 生成或重新生成（revoked 状态的「重新生成」复用同一 POST 端点）。
 * 08 §5：先确认 LAN 已在运行，未运行则引导开面板，不向成员分发不可达地址。
 * 网络状态尚未加载时不阻断，交给服务端 409 LAN_SHARE_DISABLED 兜底。
 */
function generate(): void {
  if (busy.value) return;
  const listener = networkQuery.data.value?.shareListener;
  if (listener !== undefined && !listener.running) {
    toast.show("请先开启局域网分享");
    emit("needs-network");
    return;
  }
  generateMutation.mutate();
}
</script>

<template>
  <div class="link-box">
    <template v-if="!state">
      <span class="link-none">未生成</span>
      <button class="mini-btn blue" type="button" :disabled="busy" @click="generate">生成链接</button>
    </template>

    <template v-else-if="state.status === 'active'">
      <span class="link-state">已生成</span>
      <span class="link-meta">{{ lastUsedText }}</span>
      <!-- 原型 1788：行内「复制」；完整 URL 不常驻 DOM，仅在受控结果区持有新链接时可点（D10）。 -->
      <button
        class="mini-btn blue"
        type="button"
        :disabled="issuedMemberId !== member.id"
        :title="issuedMemberId === member.id ? '复制本次生成的完整链接' : '完整链接不常驻页面；生成或重置后即可在此复制'"
        @click="emit('copy-issued')"
      >复制</button>
      <button class="mini-btn" type="button" :disabled="busy" @click="confirmRotateOpen = true">重置</button>
      <button class="mini-btn red" type="button" :disabled="busy" @click="confirmRevokeOpen = true">吊销</button>
    </template>

    <template v-else>
      <span class="link-state revoked">已吊销</span>
      <span class="link-meta">{{ revokedText }}</span>
      <button class="mini-btn blue" type="button" :disabled="busy" @click="generate">重新生成</button>
    </template>

    <BaseDialog :open="confirmRotateOpen" title="重置分享链接" @close="confirmRotateOpen = false">
      <p class="confirm-text">
        重置后「{{ member.name }}」的旧链接将立即失效，需要重新分发新链接。
      </p>
      <template #foot>
        <span class="sp" />
        <button class="btn ghost" type="button" @click="confirmRotateOpen = false">取消</button>
        <button
          class="btn primary"
          type="button"
          :disabled="rotateMutation.isPending.value"
          @click="rotateMutation.mutate()"
        >
          {{ rotateMutation.isPending.value ? "重置中…" : "重置" }}
        </button>
      </template>
    </BaseDialog>

    <BaseDialog :open="confirmRevokeOpen" title="吊销分享链接" @close="confirmRevokeOpen = false">
      <p class="confirm-text">
        吊销后「{{ member.name }}」将无法再访问成员视图，可随时重新生成。
      </p>
      <template #foot>
        <span class="sp" />
        <button class="btn ghost" type="button" @click="confirmRevokeOpen = false">取消</button>
        <button
          class="btn danger-btn"
          type="button"
          :disabled="revokeMutation.isPending.value"
          @click="revokeMutation.mutate()"
        >
          {{ revokeMutation.isPending.value ? "吊销中…" : "吊销" }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.link-box {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.link-state {
  font-size: 11.5px;
  color: var(--green);
}

.link-state.revoked {
  color: var(--red);
}

.link-meta {
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--mono);
  white-space: nowrap;
}

.link-none {
  font-size: 11.5px;
  color: var(--text-faint);
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

.mini-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-inset);
}

.mini-btn.blue {
  color: var(--blue);
  border-color: color-mix(in srgb, var(--blue) 45%, transparent);
}

/* 原型 372：蓝色变体 hover 只换底色、文字保持蓝；本组件因 :not(:disabled) 使
 * hover 规则特异性高于 .mini-btn.blue，需在变体 hover 里把 color 再声明一次（R7-D2）。 */
.mini-btn.blue:hover:not(:disabled) {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
}

.mini-btn.red {
  color: var(--red);
  border-color: color-mix(in srgb, var(--red) 40%, transparent);
}

/* 原型 374：红色变体 hover 同理保持红字（R7-D2）。 */
.mini-btn.red:hover:not(:disabled) {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 7%, transparent);
}

.mini-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.confirm-text {
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

.btn.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
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
</style>
