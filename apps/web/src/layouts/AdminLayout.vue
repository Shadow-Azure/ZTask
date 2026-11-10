<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { maskNetworkError, networkApi } from "../api/network";
import { shareApi } from "../api/share";
import { isShareUnauthorized, useShareSession } from "../features/share/useShareSession";
import { isLoopbackHostname } from "../features/share/host";
import LoadingState from "../components/ui/LoadingState.vue";
import ErrorState from "../components/ui/ErrorState.vue";

/**
 * 管理端布局：原型 appbar（logo + 事项跟踪/成员管理导航 + 状态区，原型 52–71）。
 * 白底 52px、1px 下边框；logo mark 24px 蓝渐变；导航 active 蓝字浅蓝底无边框；
 * LAN 状态 chip 轮询 GET /admin/network（15s）：running → `LAN · host:port`、
 * degraded → 分享异常、未开启 → 仅本机；点击进入成员管理页的局域网分享面板（08 §5、05 §4.9）。
 *
 * 管理壳入口（m17）：本机打开时沿用无会话管理员；LAN 打开时先恢复分享会话，
 * 只有 `isAdmin=true` 才渲染管理内容；普通成员、无会话与网络故障分别给出明确页面。
 * 这只是体验门控，真正的 Admin 授权仍在服务端逐请求校验。
 */
type GateState = "checking" | "ready" | "unauthenticated" | "forbidden" | "error";

const { member, setMember, logout } = useShareSession();
/** 本机管理端不需要成员会话；页面主机名只决定体验门控，不承担安全职责。 */
const localHost = typeof window !== "undefined" && isLoopbackHostname(window.location.hostname);
const gate = ref<GateState>(localHost ? "ready" : "checking");

/** LAN 打开时恢复会话并检查管理员权限；本机则直接进入管理壳。 */
async function restoreAdminAccess(): Promise<void> {
  if (localHost) {
    gate.value = "ready";
    return;
  }
  gate.value = "checking";
  try {
    const response = await shareApi.restore();
    setMember(response.member, response.isAdmin);
    gate.value = response.isAdmin ? "ready" : "forbidden";
  } catch (cause) {
    // 401 表示没有会话；其他错误是瞬时故障，给出可重试错误而不是误判成无权限。
    gate.value = isShareUnauthorized(cause) ? "unauthenticated" : "error";
  }
}

onMounted(restoreAdminAccess);

async function onLogout(): Promise<void> {
  await logout().catch(() => undefined);
}

const networkQuery = useQuery({
  queryKey: ["admin", "network"],
  queryFn: networkApi.network,
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
  enabled: computed(() => gate.value === "ready"),
});

/**
 * chip 四态：服务不可达 / 连接中 / 分享异常 / LAN 运行 / 仅本机。
 * 「服务不可达」不能退化成「仅本机」：那是两类完全不同的故障（08 §5）。
 */
const lanChip = computed<{ tone: "up" | "off" | "warn" | "down"; text: string; title: string }>(() => {
  if (networkQuery.isError.value) {
    return { tone: "down", text: "服务不可达", title: "无法读取网络状态，请确认 ZTask 服务仍在运行" };
  }
  const listener = networkQuery.data.value?.shareListener;
  if (!listener) return { tone: "off", text: "连接中…", title: "正在读取网络状态" };
  if (listener.degraded) {
    return { tone: "warn", text: "分享异常", title: maskNetworkError(listener.error) };
  }
  if (listener.running && listener.host) {
    const address = `${listener.host}:${listener.port ?? ""}`;
    return { tone: "up", text: `LAN · ${address}`, title: `局域网分享中：${address}` };
  }
  return { tone: "off", text: "仅本机", title: "局域网分享未开启" };
});

/** 本机管理员显示固定身份；LAN 管理员成员显示自己的姓名/颜色并可注销。 */
const displayName = computed(() => member.value?.name ?? "管理员");
const avatarText = computed(() => displayName.value.slice(0, 1));
const avatarStyle = computed(() => (member.value ? { background: member.value.color } : { background: "#212832" }));
</script>

<template>
  <div class="admin-shell">
    <div class="appbar">
      <div class="logo"><span class="mark">Z</span>ZTask<span class="sub">团队事项跟踪</span></div>
      <nav v-if="gate === 'ready'" class="appnav" aria-label="管理导航">
        <RouterLink to="/tracker" class="nav-item" :class="{ active: $route.name === 'tracker' }">事项跟踪</RouterLink>
        <RouterLink to="/members" class="nav-item" :class="{ active: $route.name === 'members' }">成员管理</RouterLink>
      </nav>
      <div v-if="gate === 'ready'" class="who">
        <RouterLink to="/members" class="lan-chip" :class="lanChip.tone" :title="lanChip.title">
          {{ lanChip.text }}
        </RouterLink>
        <span class="ava" :style="avatarStyle" :title="displayName">{{ avatarText }}</span>
        <span>{{ displayName }}</span>
        <button v-if="member" class="logout" type="button" @click="onLogout">注销</button>
      </div>
    </div>

    <RouterView v-if="gate === 'ready'" />
    <div v-else class="admin-gate">
      <LoadingState v-if="gate === 'checking'" label="正在验证管理员会话…" />
      <div v-else-if="gate === 'unauthenticated'" class="gate-card">
        <h1>需要管理员会话</h1>
        <p>管理页仅能从服务主机本机打开，或由已授予管理员权限的成员通过分享链接进入。</p>
      </div>
      <div v-else-if="gate === 'forbidden'" class="gate-card">
        <h1>没有管理员权限</h1>
        <p>该分享链接属于普通成员，无法打开管理页。请联系管理员授予权限。</p>
      </div>
      <ErrorState v-else message="无法验证管理员会话" retryable @retry="restoreAdminAccess" />
    </div>
  </div>
</template>

<style scoped>
.admin-shell {
  min-height: 100vh;
}

/* 原型 53–56：52px 白底产品 appbar，1px 下边框。 */
.appbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  height: 52px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  color: var(--text);
  position: sticky;
  top: 0;
  z-index: 100;
}

/* 原型 57–62：15px/700 文字 + 24px 蓝渐变 mark（圆角 7、字重 800）。 */
.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.logo .mark {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--blue), var(--blue-light));
  color: #fff;
  font-size: 13px;
  font-weight: 800;
}

.logo .sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-faint);
  margin-left: 2px;
}

/* 原型 63–69：13px 导航；active 蓝字 + 10% 浅蓝底、无边框。 */
.appnav {
  display: flex;
  gap: 2px;
  margin-left: 22px;
}

.nav-item {
  font-size: 13px;
  color: var(--text-dim);
  text-decoration: none;
  padding: 5px 14px;
  border-radius: 8px;
}

.nav-item:hover {
  background: var(--bg-inset);
}

.nav-item.active {
  color: var(--blue);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  font-weight: 600;
}

/* 原型 70–71：右侧身份区 + LAN chip（mono 10.5px 绿字浅绿底）。 */
.who {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-dim);
  font-size: 12px;
}

.lan-chip {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-dim);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1.5px 9px;
  text-decoration: none;
  white-space: nowrap;
}

.lan-chip.up {
  color: var(--green);
  background: color-mix(in srgb, var(--green) 10%, transparent);
  border-color: color-mix(in srgb, var(--green) 30%, transparent);
}

.lan-chip.warn {
  color: var(--orange);
  background: color-mix(in srgb, var(--orange) 10%, transparent);
  border-color: color-mix(in srgb, var(--orange) 30%, transparent);
}

.lan-chip.down {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
  border-color: color-mix(in srgb, var(--red) 30%, transparent);
}

.lan-chip:hover {
  filter: brightness(0.97);
}

/* 原型 74–77：22px 圆形头像；管理员固定 #212832 底，管理员成员用成员色。 */
.ava {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #212832;
  color: #fff;
  display: inline-grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
}

/* 管理员成员的注销动作：与成员壳同样保持低强调的描边按钮。 */
.logout {
  font: inherit;
  font-size: 11.5px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 2px 10px;
  cursor: pointer;
}

.logout:hover {
  color: var(--text);
  background: var(--bg-inset);
}

/* 管理壳门控：无会话、非管理员或恢复失败时占据内容区，不渲染任何管理页面。 */
.admin-gate {
  min-height: calc(100vh - 52px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.admin-gate :deep(.error-state) {
  width: min(420px, 100%);
}

.gate-card {
  width: min(460px, 100%);
  padding: 22px 24px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.gate-card h1 {
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 8px;
}

.gate-card p {
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-dim);
}

@media (max-width: 900px) {
  .logo .sub {
    display: none;
  }
}
</style>
