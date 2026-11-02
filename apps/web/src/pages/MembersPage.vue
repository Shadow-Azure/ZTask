<script setup lang="ts">
/**
 * 成员管理页（08 §5，仅管理员）：成员表格 + 编辑浮窗 + 归档确认由 MemberTable 承载。
 */
import MemberTable from "../features/members/MemberTable.vue";
</script>

<template>
  <div class="members-body">
    <div class="page-title-row">
      <h2>团队成员</h2>
      <span class="page-sub">成员通过各自的分享链接访问，仅能查看与更新和自己相关的事项</span>
    </div>
    <MemberTable />
    <p class="hint-line">「归档」后成员无法再访问，其任务分配显示为待分配，历史任务与操作记录完整保留；分享链接将在 m4 接入。</p>
  </div>
</template>

<style scoped>
.members-body {
  padding: 16px;
}

.page-title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 12px;
}

.page-title-row h2 {
  font-size: 15px;
}

.page-sub {
  font-size: 11.5px;
  color: var(--text-faint);
}

.hint-line {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 10px;
}
</style>
