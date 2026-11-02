<script setup lang="ts">
/**
 * 成员个人页占位（原型"成员链接 · 某某"）：只显示身份区与负责/协作两组占位；
 * 任务卡与进度/详情/小任务编辑由 m4（share 域 API）接入。
 */
import EmptyState from "../components/ui/EmptyState.vue";
</script>

<template>
  <div class="share-body">
    <div class="share-id">
      <span class="ava" aria-hidden="true">成</span>
      <div>
        <div class="hello">你好，成员</div>
        <div class="scope">此链接仅展示与你相关的事项（你负责的 0 项 · 你协作的 0 项），其他成员的任务不可见。</div>
      </div>
    </div>
    <div class="share-body-inner">
      <div class="share-group">
        <h3>我负责的任务 <span class="cnt">0</span></h3>
        <p class="gdesc">可以更新进度（需保存）、编辑完整详情并管理小任务。</p>
        <EmptyState hint="成员任务数据将在 m4 接入 share API" title="暂无你负责的任务" />
      </div>
      <div class="share-group">
        <h3>我协作的任务 <span class="cnt">0</span></h3>
        <p class="gdesc">协作任务由负责人维护进度，此处只读。</p>
        <EmptyState hint="成员任务数据将在 m4 接入 share API" title="暂无你协作的任务" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.share-body {
  padding: 16px;
  max-width: 980px;
  margin: 0 auto;
}

.share-id {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 14px 16px;
  margin-bottom: 14px;
}

.ava {
  width: 34px;
  height: 34px;
  border-radius: 999px;
  background: var(--blue);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}

.hello {
  font-size: 14px;
  font-weight: 600;
}

.scope {
  font-size: 11.5px;
  color: var(--text-dim);
}

.share-group {
  margin-bottom: 16px;
}

.share-group h3 {
  font-size: 13px;
}

.share-group .cnt {
  color: var(--text-faint);
  font-weight: 400;
  font-size: 11.5px;
}

.gdesc {
  font-size: 11.5px;
  color: var(--text-faint);
  margin: 4px 0 8px;
}
</style>
