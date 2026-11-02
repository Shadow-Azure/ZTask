<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useShareSession } from "../features/share/useShareSession";
import LoadingState from "../components/ui/LoadingState.vue";
import ErrorState from "../components/ui/ErrorState.vue";

/**
 * 成员壳（08 §6.1，原型 381–390）：挂载时用 Cookie 恢复会话，
 * 未确认会话前不渲染 RouterView，避免子页先发 401 请求；
 * 401 进入失效页；网络/5xx 等瞬时故障在壳内给出可重试错误，不误判成链接失效（§6.8）。
 * 顶栏组合对齐原型 388–390：logo + 链接地址 chip（D12）；出于安全不回显完整链接
 * （token 不入 DOM，05 §6.1），chip 只展示当前访问的 `http://<host>`。
 * 「成员个人页 / 事项跟踪」导航与右侧成员身份/注销是 web 的功能增强（B-3/B-4）。
 */
const { member, restore, logout } = useShareSession();

/** 本次挂载是否已完成会话确认；只用于门控 RouterView，避免模块态跨页面泄漏。 */
const ready = ref(false);
/** 恢复的瞬时失败（非 401）：在壳内显示 ErrorState，重试成功后照常渲染成员内容。 */
const restoreFailed = ref(false);

const initial = computed(() => (member.value?.name ?? "成").slice(0, 1));
/** 访问地址 chip（不含 token）：成员正是通过该主机打开此页的。 */
const hostUrl = computed(() => `http://${window.location.host}`);

/**
 * 尝试恢复会话；401 由 restore 内部进入失效页，非 401 只标记壳内错误态。
 */
async function restoreSession(): Promise<void> {
  restoreFailed.value = false;
  try {
    ready.value = await restore();
  } catch {
    // 网络/5xx 是瞬时故障，不代表链接失效：留在壳内让用户重试（08 §6.1）。
    ready.value = false;
    restoreFailed.value = true;
  }
}

onMounted(restoreSession);

async function onLogout(): Promise<void> {
  // logout 内部先清 share 作用域缓存再进入失效页；请求失败也保持同一结局（08 §7）。
  await logout().catch(() => undefined);
}
</script>

<template>
  <div class="share-shell">
    <header class="share-bar">
      <div class="logo"><span class="mark">Z</span>ZTask<span class="sub">成员视图</span></div>

      <!-- D12（原型 382）：mono 地址 chip；完整链接含 token，出于安全只展示主机地址。 -->
      <span class="url" title="完整成员链接含访问凭证，出于安全不在页面回显">{{ hostUrl }}</span>

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
    <div v-else-if="restoreFailed" class="share-restoring">
      <ErrorState message="无法连接 ZTask 服务" retryable @retry="restoreSession" />
    </div>
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

/* D12（原型 382）：mono 11px 地址 chip、inset 底、1px 描边、圆角 6。 */
.share-bar .url {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-faint);
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
  flex: none;
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

/* 恢复失败的瞬时故障提示与恢复中的加载态共用居中容器，限宽避免整行拉满。 */
.share-restoring :deep(.error-state) {
  width: min(420px, 100%);
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
