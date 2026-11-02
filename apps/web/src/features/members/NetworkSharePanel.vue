<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { ApiError } from "@ztask/shared";
import { maskNetworkError, networkApi } from "../../api/network";
import { useToast } from "../../components/ui/toast";
import BaseDialog from "../../components/ui/BaseDialog.vue";
import LoadingState from "../../components/ui/LoadingState.vue";
import ErrorState from "../../components/ui/ErrorState.vue";

/**
 * 局域网分享面板（08 §5，05 §4.9）：展示 loopback/LAN 状态与 shareBaseUrl，
 * 支持选择具体网卡地址、开启、切换与关闭监听。所有状态来自 GET /admin/network 的
 * 运行时事实，失败时保留当前状态，绝不把 422/未 bind 成功显示成已开启。
 */
const queryClient = useQueryClient();
const toast = useToast();

const FALLBACK_PORT = 8123;
const PORT_MIN = 1;
const PORT_MAX = 65_535;

const networkQuery = useQuery({
  queryKey: ["admin", "network"],
  queryFn: networkApi.network,
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
});

/** 面板根节点：needs-network 时滚动并聚焦到这里（tabindex=-1）。 */
const rootEl = ref<HTMLElement | null>(null);
/** 聚焦/滚动后的短暂高亮，提示用户「先开启局域网分享」。 */
const attention = ref(false);
let attentionTimer: ReturnType<typeof setTimeout> | null = null;

const interfaces = computed(() => networkQuery.data.value?.interfaces ?? []);
const listener = computed(() => networkQuery.data.value?.shareListener ?? null);
const running = computed(() => listener.value?.running === true);
const degraded = computed(() => listener.value?.degraded === true);

const host = ref("");
const portInput = ref(String(FALLBACK_PORT));
const portError = ref("");
/** 运行中切换地址时才展开表单；未运行时始终展示开启表单。 */
const switching = ref(false);
const confirmCloseOpen = ref(false);

/**
 * 默认分享端口跟随 loopback 实际端口（01 §3「两个监听默认共用端口」）：
 * `--port 9000` 启动时不能把 LAN 监听默认写死成 8123。
 */
const defaultPort = computed(() => {
  const url = networkQuery.data.value?.loopbackUrl;
  if (!url) return FALLBACK_PORT;
  try {
    const parsed = new URL(url);
    return parsed.port === "" ? FALLBACK_PORT : Number(parsed.port);
  } catch {
    return FALLBACK_PORT;
  }
});

watch(
  defaultPort,
  (port) => {
    // 只在用户尚未开始编辑（表单收起且分享未运行）时同步默认值，避免 15s 轮询覆盖手输端口。
    if (!switching.value && !running.value) portInput.value = String(port);
  },
  { immediate: true },
);

watch(
  [interfaces, listener],
  ([list, state]) => {
    // 默认选第一项；有上次选择的可用地址时优先恢复；选择失效（网卡拔掉）时回落到第一项。
    const remembered = state?.host && list.some((item) => item.address === state.host) ? state.host : "";
    if (!list.some((item) => item.address === host.value)) {
      host.value = remembered || list[0]?.address || "";
    }
  },
  { immediate: true },
);

const statusChip = computed<{ tone: "up" | "off" | "warn"; text: string }>(() => {
  const state = listener.value;
  if (!state) return { tone: "off", text: "已关闭 · 仅本机可用" };
  if (state.degraded) return { tone: "warn", text: "分享异常" };
  if (state.running && state.host) {
    return { tone: "up", text: `分享中 · ${state.host}:${state.port ?? ""}` };
  }
  return { tone: "off", text: "已关闭 · 仅本机可用" };
});

const shareBaseUrl = computed(() => {
  const state = listener.value;
  if (!state?.running) return "";
  if (state.shareBaseUrl) return state.shareBaseUrl;
  return state.host ? `http://${state.host}:${state.port ?? ""}` : "";
});


/**
 * 校验端口输入（05 §4.9：非法端口由前端先拦，避免无意义请求）。
 * @returns 1–65535 的整数端口；非法返回 null。
 */
function parsePort(): number | null {
  const text = portInput.value.trim();
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) return null;
  return port;
}

function openSwitch(): void {
  const state = listener.value;
  host.value = state?.host ?? interfaces.value[0]?.address ?? "";
  portInput.value = String(state?.port ?? defaultPort.value);
  portError.value = "";
  switching.value = true;
}

function closeSwitch(): void {
  switching.value = false;
  portError.value = "";
}

/**
 * 焦点入口：LAN_SHARE_DISABLED 时由 MembersPage 调用，滚动到面板并聚焦，
 * 同时短暂高亮提示「先开启局域网分享」。
 */
function focus(): void {
  rootEl.value?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  rootEl.value?.focus();
  attention.value = true;
  if (attentionTimer) clearTimeout(attentionTimer);
  attentionTimer = setTimeout(() => {
    attention.value = false;
    attentionTimer = null;
  }, 1600);
}

defineExpose({ focus });

/** 开启/切换失败：422 等错误按统一错误面提示，保留当前状态等待重试。 */
function onListenFailed(cause: unknown): void {
  if (cause instanceof ApiError && cause.code === "LAN_INTERFACE_INVALID") {
    toast.show("网卡地址不可用，请重新选择");
    return;
  }
  toast.show(cause instanceof Error ? cause.message : "开启局域网分享失败");
}

function invalidateShareViews(): void {
  void queryClient.invalidateQueries({ queryKey: ["admin", "network"] });
  // shareBaseUrl 变化会影响链接展示，成员列表一并失效（08 §5）。
  void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
}

const enableMutation = useMutation({
  mutationFn: (input: { host: string; port: number }) => networkApi.enableShareListener(input),
  onSuccess: (next) => {
    const state = next.shareListener;
    if (!state?.running) {
      toast.show(`分享未开启：${maskNetworkError(state?.error ?? null, "监听未启动，请重新选择地址")}`);
    } else if (switching.value) {
      toast.show(`已切换分享地址：${state.host}:${state.port}；旧 URL 需要重新分发`);
    } else {
      toast.show(`已开启局域网分享：${state.host}:${state.port}`);
    }
    switching.value = false;
    portError.value = "";
    invalidateShareViews();
  },
  onError: onListenFailed,
});

const disableMutation = useMutation({
  mutationFn: () => networkApi.disableShareListener(),
  onSuccess: () => {
    confirmCloseOpen.value = false;
    switching.value = false;
    toast.show("已关闭局域网分享；token 未吊销，重新开启后旧链接仍可用");
    void queryClient.invalidateQueries({ queryKey: ["admin", "network"] });
  },
  onError: (cause: unknown) => {
    confirmCloseOpen.value = false;
    toast.show(cause instanceof Error ? cause.message : "关闭局域网分享失败");
  },
});

/** 提交开启或切换：先做本地端口校验，再交给后端 bind 结果决定 UI 事实。 */
function submit(): void {
  if (enableMutation.isPending.value) return;
  const port = parsePort();
  if (port === null) {
    portError.value = "端口需为 1–65535 的整数";
    return;
  }
  if (!host.value) {
    portError.value = "请选择分享网卡";
    return;
  }
  portError.value = "";
  enableMutation.mutate({ host: host.value, port });
}
</script>

<template>
  <section
    ref="rootEl"
    class="network-panel"
    :class="{ attention }"
    tabindex="-1"
    aria-label="局域网分享"
  >
    <div class="net-head">
      <h3>局域网分享</h3>
      <span class="net-status-chip" :class="statusChip.tone">{{ statusChip.text }}</span>
      <code v-if="running && shareBaseUrl" class="net-base-url" :title="shareBaseUrl">{{ shareBaseUrl }}</code>
    </div>

    <LoadingState v-if="networkQuery.isLoading.value" label="网络状态加载中…" />
    <ErrorState
      v-else-if="networkQuery.isError.value"
      message="网络状态加载失败"
      retryable
      @retry="networkQuery.refetch()"
    />
    <template v-else>
      <p v-if="degraded" class="net-error">
        分享异常：{{ maskNetworkError(listener?.error ?? null, "监听未启动，请重新选择地址") }}
      </p>

      <div v-if="!running" class="net-form">
        <label class="net-field">
          <span>分享网卡</span>
          <select v-model="host" class="net-iface" :disabled="enableMutation.isPending.value">
            <option v-for="item in interfaces" :key="item.address" :value="item.address">
              {{ item.name }} · {{ item.address }}
            </option>
          </select>
        </label>
        <label class="net-field net-field-port">
          <span>端口</span>
          <input
            v-model="portInput"
            class="net-port"
            type="text"
            inputmode="numeric"
            :disabled="enableMutation.isPending.value"
          >
        </label>
        <button
          class="btn primary net-enable"
          type="button"
          :disabled="enableMutation.isPending.value || interfaces.length === 0"
          @click="submit"
        >
          {{ enableMutation.isPending.value ? "开启中…" : degraded ? "重新选择地址并开启" : "开启局域网分享" }}
        </button>
      </div>

      <div v-else class="net-running">
        <span class="net-running-hint">成员可通过该地址访问；切换地址后旧 URL 需重新分发。</span>
        <button v-if="degraded" class="btn net-reselect" type="button" @click="openSwitch">重新选择地址</button>
        <button v-else class="btn net-switch" type="button" @click="openSwitch">切换地址</button>
        <button class="btn net-close" type="button" @click="confirmCloseOpen = true">关闭分享</button>
      </div>

      <div v-if="running && switching" class="net-form net-switch-form">
        <label class="net-field">
          <span>分享网卡</span>
          <select v-model="host" class="net-iface" :disabled="enableMutation.isPending.value">
            <option v-for="item in interfaces" :key="item.address" :value="item.address">
              {{ item.name }} · {{ item.address }}
            </option>
          </select>
        </label>
        <label class="net-field net-field-port">
          <span>端口</span>
          <input
            v-model="portInput"
            class="net-port"
            type="text"
            inputmode="numeric"
            :disabled="enableMutation.isPending.value"
          >
        </label>
        <button
          class="btn primary net-apply"
          type="button"
          :disabled="enableMutation.isPending.value"
          @click="submit"
        >
          {{ enableMutation.isPending.value ? "切换中…" : "确认切换" }}
        </button>
        <button class="btn ghost net-cancel" type="button" @click="closeSwitch">取消</button>
      </div>

      <p v-if="portError" class="net-field-error">{{ portError }}</p>
      <p v-if="interfaces.length === 0 && !running" class="net-hint">
        未发现可分享的网卡地址；请确认本机已联网后重试。
      </p>
    </template>

    <BaseDialog :open="confirmCloseOpen" title="关闭局域网分享" @close="confirmCloseOpen = false">
      <p class="confirm-text">
        关闭后仅停止局域网访问，本机管理端不受影响；不会吊销任何 token，重新开启分享后旧链接仍然可用。
      </p>
      <template #foot>
        <span class="sp" />
        <button class="btn ghost" type="button" @click="confirmCloseOpen = false">取消</button>
        <button
          class="btn primary net-confirm-close"
          type="button"
          :disabled="disableMutation.isPending.value"
          @click="disableMutation.mutate()"
        >
          {{ disableMutation.isPending.value ? "关闭中…" : "确认关闭" }}
        </button>
      </template>
    </BaseDialog>
  </section>
</template>

<style scoped>
.network-panel {
  margin-bottom: 12px;
  padding: 10px 14px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12.5px;
}

.network-panel:focus-visible {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}

.network-panel.attention {
  border-color: color-mix(in srgb, var(--blue) 55%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--blue) 16%, transparent);
}

.net-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.net-head h3 {
  font-size: 13px;
}

.net-status-chip {
  font-size: 10.5px;
  border-radius: 999px;
  padding: 1.5px 9px;
  border: 1px solid var(--border-strong);
  color: var(--text-faint);
  background: var(--bg-inset);
  font-family: var(--mono);
}

.net-status-chip.up {
  color: var(--green);
  border-color: color-mix(in srgb, var(--green) 30%, transparent);
  background: color-mix(in srgb, var(--green) 10%, transparent);
}

.net-status-chip.warn {
  color: var(--orange);
  border-color: color-mix(in srgb, var(--orange) 35%, transparent);
  background: color-mix(in srgb, var(--orange) 10%, transparent);
}

.net-base-url {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 8px;
  max-width: 46ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.net-form {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 10px;
}

.net-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: var(--text-faint);
}

.net-iface {
  font: inherit;
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 4px 8px;
  min-width: 220px;
}

.net-port {
  font: inherit;
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 4px 8px;
  width: 84px;
}

.net-running {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.net-running-hint {
  font-size: 11.5px;
  color: var(--text-faint);
  margin-right: auto;
}

.net-error {
  font-size: 11.5px;
  color: var(--orange);
  margin-bottom: 8px;
}

.net-hint {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 8px;
}

.net-field-error {
  font-size: 11px;
  color: var(--red);
  margin-top: 6px;
}

.btn {
  font: inherit;
  font-size: 12.5px;
  border-radius: 7px;
  padding: 5px 13px;
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
  opacity: 0.6;
  cursor: not-allowed;
}

.confirm-text {
  font-size: 12.5px;
  color: var(--text-dim);
}

.sp {
  flex: 1;
}
</style>
