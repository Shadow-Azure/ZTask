<script setup lang="ts">
/**
 * 失效链接页（03 §2 /#/share-invalid）：不含任何业务导航。
 */
</script>

<template>
  <div class="invalid-body">
    <div class="invalid-card" role="alert">
      <h2>链接已失效</h2>
      <p class="note">这个分享链接不存在、已被重置或吊销。请联系管理员重新获取新的专属链接。</p>
    </div>
  </div>
</template>

<style scoped>
.invalid-body {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bg);
}

.invalid-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px 28px;
  max-width: 420px;
  text-align: center;
}

.invalid-card h2 {
  font-size: 15px;
  margin-bottom: 8px;
}

.note {
  font-size: 12px;
  color: var(--text-dim);
}
</style>
