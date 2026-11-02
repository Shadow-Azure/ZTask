<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { API_PREFIX } from "@ztask/shared";
import { requestJson } from "../api/http";
import type { HealthPayload } from "@ztask/shared";

/**
 * 管理端布局：原型 appbar（logo + 事项跟踪/成员管理导航 + 状态区）。
 * LAN 分享地址与网络管理是 #20 的范围，此处显示服务健康状态。
 */
const health = useQuery({
  queryKey: ["admin", "health"],
  queryFn: () => requestJson<HealthPayload>(`${API_PREFIX}/health`),
  refetchOnWindowFocus: true,
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
        <span class="lan-chip" :class="health.isError.value ? 'down' : ''">
          <template v-if="health.data.value">服务正常 · v{{ health.data.value.version }}</template>
          <template v-else-if="health.isLoading.value">连接中…</template>
          <template v-else>服务不可达</template>
        </span>
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
  color: #7ee2b8;
  border: 1px solid #2c3a31;
  background: rgba(31, 157, 107, 0.12);
  border-radius: 999px;
  padding: 2px 10px;
}

.lan-chip.down {
  color: #ff9b9b;
  border-color: #42302f;
  background: rgba(214, 60, 60, 0.12);
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
