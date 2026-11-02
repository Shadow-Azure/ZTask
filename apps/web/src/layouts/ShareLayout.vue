<script setup lang="ts">
/**
 * 成员壳（03 §2）：只提供"成员个人页"和"事项跟踪"两个导航；
 * 不存在成员管理、链接管理或网络配置——越权导航从前端就不渲染。
 */
</script>

<template>
  <div class="share-shell">
    <div class="share-bar">
      <div class="logo"><span class="mark">Z</span>ZTask<span class="sub">成员视图</span></div>
      <nav class="share-nav" aria-label="成员导航">
        <RouterLink to="/s/home" class="nav-item" :class="{ active: $route.name === 'share-home' }">成员个人页</RouterLink>
        <RouterLink to="/s/tracker" class="nav-item" :class="{ active: $route.name === 'share-tracker' }">事项跟踪</RouterLink>
      </nav>
    </div>
    <RouterView />
  </div>
</template>

<style scoped>
.share-shell {
  min-height: 100vh;
  background: var(--bg);
}

.share-bar {
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
}

.share-nav {
  display: flex;
  gap: 4px;
  margin-left: 12px;
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
</style>
