<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useShareSession } from "../features/share/useShareSession";
import LoadingState from "../components/ui/LoadingState.vue";

/**
 * 成员壳（08 §6.1，原型 381–390）：挂载时用 Cookie 恢复会话，
 * 未确认会话前不渲染 RouterView，避免子页先发 401 请求；
 * 恢复失败统一进入失效页。导航严格只有「成员个人页」「事项跟踪」两个链接，
 * 顶栏右侧展示脱敏成员身份与注销按钮——不渲染 token/链接原文。
 */
const router = useRouter();
const { member, restore, logout } = useShareSession();

/** 本次挂载是否已完成会话确认；只用于门控 RouterView，避免模块态跨页面泄漏。 */
const ready = ref(false);

const initial = computed(() => (member.value?.name ?? "成").slice(0, 1));

onMounted(async () => {
  try {
    ready.value = await restore();
  } catch {
    // 非 401 的恢复失败同样不能渲染成员内容（08 §6.1）。
    await router.replace("/share-invalid");
  }
});

async function onLogout(): Promise<void> {
  // logout 内部先清 share 作用域缓存再进入失效页；请求失败也保持同一结局（08 §7）。
  await logout().catch(() => undefined);
}
</script>

<template>
  <div class="share-shell">
    <header class="share-bar">
      <div class="logo"><span class="mark">Z</span>ZTask<span class="sub">成员视图</span></div>

      <nav v-if="ready && member" class="share-nav" aria-label="成员导航">
        <RouterLink to="/s/home" class="nav-item" :class="{ active: $route.name === 'share-home' }">成员个人页</RouterLink>
        <RouterLink to="/s/tracker" class="nav-item" :class="{ active: $route.name === 'share-tracker' }">事项跟踪</RouterLink>
      </nav>

      <div v-if="ready && member" class="share-user">
        <span class="ava" :style="{ background: member.color }" :title="member.name" aria-hidden="true">{{ initial }}</span>
        <span class="share-user-name">{{ member.name }}</span>
        <button class="ghost" type="button" @click="onLogout">注销</button>
      </div>
    </header>

    <RouterView v-if="ready && member" />
    <div v-else class="share-restoring">
      <LoadingState label="正在恢复成员会话…" />
    </div>
  </div>
</template>

<style scoped>
.share-shell {
  min-height: 100vh;
  background: var(--bg);
}

/* 原型 381–382：48px 浅色品牌条。 */
.share-bar {
  height: 48px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 18px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  flex: none;
}

.logo .mark {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--blue), #6f9bff);
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

.share-nav {
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

.share-user {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
  min-width: 0;
}

.ava {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-grid;
  place-items: center;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  flex: none;
}

.share-user-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 注销是动作而非导航项：ghost 按钮与链接视觉分离（08 §6.1）。 */
.ghost {
  font: inherit;
  font-size: 12px;
  color: var(--text-dim);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 3px 12px;
  cursor: pointer;
  flex: none;
}

.ghost:hover {
  color: var(--text);
  background: var(--bg-inset);
}

.share-restoring {
  min-height: calc(100vh - 48px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

@media (max-width: 720px) {
  .share-bar {
    height: auto;
    min-height: 48px;
    flex-wrap: wrap;
    padding: 8px 14px;
    row-gap: 6px;
  }

  .logo .sub {
    display: none;
  }

  .share-nav {
    margin-left: 0;
  }

  .share-user-name {
    max-width: 96px;
  }
}
</style>
