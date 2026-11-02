<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

/**
 * 分享令牌交换页占位（/#/s/<token>）：会话交换（POST /share/session、
 * HttpOnly Cookie、地址清理）由 m4 接入；本页只落结构且绝不显示原始 token。
 */
const route = useRoute();

/** token 只显示首尾片段，中间以长度代替（不把 secret 泄露进 DOM）。 */
const maskedToken = computed(() => {
  const token = String(route.params.token ?? "");
  if (token.length <= 8) return "••••••";
  return `${token.slice(0, 4)}••••${token.slice(-4)}（长度 ${token.length}）`;
});
</script>

<template>
  <div class="session-body">
    <div class="session-card">
      <h2>正在验证你的专属链接…</h2>
      <p class="token-line">链接标识：{{ maskedToken }}</p>
      <p class="note">会话交换（令牌 → HttpOnly Cookie）将在 m4 接入；交换成功后地址栏会立即清除链接标识。</p>
    </div>
  </div>
</template>

<style scoped>
.session-body {
  min-height: calc(100vh - 46px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.session-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 22px 26px;
  max-width: 420px;
}

.session-card h2 {
  font-size: 14px;
  margin-bottom: 8px;
}

.token-line {
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text-dim);
  word-break: break-all;
}

.note {
  font-size: 11.5px;
  color: var(--text-faint);
  margin-top: 8px;
}
</style>
