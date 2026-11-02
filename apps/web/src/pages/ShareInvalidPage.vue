<script setup lang="ts">
/**
 * 失效链接页（08 §6.1，原型 1941–1953）：品牌条 + .dead-card。
 * 不渲染任何业务导航、链接或 token；只能由管理员重新分发链接。
 */
</script>

<template>
  <div class="dead-page">
    <header class="dead-bar">
      <div class="logo"><span class="mark">Z</span>ZTask<span class="sub">成员视图</span></div>
    </header>
    <div class="dead-wrap">
      <div class="dead-card" role="alert">
        <div class="ic" aria-hidden="true">🔗</div>
        <h2>链接已失效</h2>
        <p>该分享链接已被管理员重置或吊销。<br>请联系管理员获取新的访问链接。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dead-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* 原型 381–382 的品牌条，这里不渲染 URL/token。 */
.dead-bar {
  height: 48px;
  display: flex;
  align-items: center;
  padding: 0 18px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  flex: none;
}

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

/* 原型 408–412：占满品牌条以下的剩余高度并居中。 */
.dead-wrap {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}

.dead-card {
  text-align: center;
  max-width: 380px;
}

.dead-card .ic {
  font-size: 40px;
  margin-bottom: 12px;
}

.dead-card h2 {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 8px;
}

.dead-card p {
  font-size: 12.5px;
  color: var(--text-dim);
}

@media (max-width: 720px) {
  .logo .sub {
    display: none;
  }
}
</style>
