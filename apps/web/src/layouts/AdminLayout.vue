<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { maskNetworkError, networkApi } from "../api/network";

/**
 * 管理端布局：原型 appbar（logo + 事项跟踪/成员管理导航 + 状态区，原型 52–71）。
 * 白底 52px、1px 下边框；logo mark 24px 蓝渐变；导航 active 蓝字浅蓝底无边框；
 * LAN 状态 chip 轮询 GET /admin/network（15s）：running → `LAN · host:port`、
 * degraded → 分享异常、未开启 → 仅本机；点击进入成员管理页的局域网分享面板（08 §5、05 §4.9）。
 */
const networkQuery = useQuery({
  queryKey: ["admin", "network"],
  queryFn: networkApi.network,
  refetchInterval: 15_000,
  refetchOnWindowFocus: true,
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

</script>

<template>
  <div class="admin-shell">
    <div class="appbar">
      <div class="logo"><span class="mark">Z</span>ZTask<span class="sub">团队事项跟踪</span></div>
      <nav class="appnav" aria-label="管理导航">
        <RouterLink to="/tracker" class="nav-item" :class="{ active: $route.name === 'tracker' }">事项跟踪</RouterLink>
        <RouterLink to="/members" class="nav-item" :class="{ active: $route.name === 'members' }">成员管理</RouterLink>
      </nav>
      <div class="who">
        <RouterLink to="/members" class="lan-chip" :class="lanChip.tone" :title="lanChip.title">
          {{ lanChip.text }}
        </RouterLink>
        <span class="ava" title="管理员">管</span>
        <span>管理员</span>
      </div>
    </div>
    <RouterView />
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

/* 原型 74–77：22px 圆形头像；管理员固定 #212832 底。 */
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

@media (max-width: 900px) {
  .logo .sub {
    display: none;
  }
}
</style>
