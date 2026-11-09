<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { shareApi } from "../api/share";
import { useShareSession } from "../features/share/useShareSession";
import LoadingState from "../components/ui/LoadingState.vue";

/**
 * 分享令牌交换页（08 §6.1，03 §2 /#/s/<token>）：
 * POST /share/session 换 HttpOnly 会话 → setMember + 清 share 缓存 → replace：
 * 管理员成员进入 /#/tracker 管理页，普通成员进入 /#/s/home；让 fragment token 从地址栏消失。
 * 失败统一进入失效页。token 只作为 exchange 的参数短暂存在，不进 ref/DOM/console/localStorage。
 */
const route = useRoute();
const router = useRouter();
const { setMember, clearShareCache } = useShareSession();

const state = ref<"loading" | "error">("loading");

onMounted(async () => {
  const token = String(route.params.token ?? "");
  try {
    const response = await shareApi.exchange(token);
    setMember(response.member, response.isAdmin);
    // 清理 share 作用域缓存，防止上一个会话的私有数据残留（08 §7）。
    clearShareCache();
    await router.replace(response.isAdmin ? "/tracker" : "/s/home");
  } catch {
    state.value = "error";
    clearShareCache();
    await router.replace("/share-invalid");
  }
});
</script>

<template>
  <div class="session-body">
    <LoadingState :label="state === 'loading' ? '正在验证你的专属链接…' : '链接验证失败，正在跳转…'" />
  </div>
</template>

<style scoped>
.session-body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--bg);
}
</style>
