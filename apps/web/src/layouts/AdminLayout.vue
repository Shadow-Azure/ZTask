<script setup lang="ts">
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { maskNetworkError, networkApi } from "../api/network";

/**
 * 管理端布局：原型 appbar（logo + 事项跟踪/成员管理导航 + 状态区）。
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

.appbar {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 16px;
  height: 46px;
  background: #16181d;
  color: #cfd4dc;
  position: sticky;
  top: 0;
  z-index: 100;
}

.logo {
  font-weight: 700;
  font-size: 13.5px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 6px;
}

.logo .mark {
  background: var(--blue);
  color: #fff;
  border-radius: 6px;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
}

.logo .sub {
  font-weight: 400;
  font-size: 11px;
  color: #8a919c;
  margin-left: 2px;
}

.appnav {
  display: flex;
  gap: 4px;
}

.nav-item {
  font-size: 12.5px;
  color: #aeb5c0;
  text-decoration: none;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 4px 12px;
}

.nav-item:hover {
  color: #e8ebef;
}

.nav-item.active {
  color: #fff;
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 35%, transparent);
}

.who {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #aeb5c0;
}

.lan-chip {
  font-size: 10.5px;
  font-family: var(--mono);
  color: #aeb5c0;
  border: 1px solid #333a45;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 999px;
  padding: 2px 10px;
  text-decoration: none;
}

.lan-chip:hover {
  color: #e8ebef;
  border-color: #4a5563;
}

.lan-chip.down {
  color: #ff9b9b;
  border-color: #42302f;
  background: rgba(214, 60, 60, 0.12);
}

.lan-chip.up {
  color: #7ee2b8;
  border-color: #2c3a31;
  background: rgba(31, 157, 107, 0.12);
}

.lan-chip.warn {
  color: #ffc27a;
  border-color: #42362a;
  background: rgba(217, 123, 28, 0.14);
}

.ava {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: #212832;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

@media (max-width: 900px) {
  .logo .sub {
    display: none;
  }
}
</style>
