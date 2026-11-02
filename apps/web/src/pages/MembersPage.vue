<script setup lang="ts">
/**
 * 成员管理页占位（仅管理员）：表格结构与提示落位，
 * 成员/链接/网络数据由 m4 接入。
 */
import EmptyState from "../components/ui/EmptyState.vue";
</script>

<template>
  <div class="members-body">
    <div class="page-title-row">
      <h2>团队成员</h2>
      <span class="page-sub">成员通过各自的分享链接访问，仅能查看与更新和自己相关的事项</span>
      <span class="flex-spacer" />
      <button class="btn primary" type="button" disabled title="成员数据在 m4 接入">＋ 添加成员</button>
    </div>
    <table class="mem-table">
      <thead>
        <tr>
          <th class="col-member">成员</th>
          <th>角色</th>
          <th class="col-count">负责中</th>
          <th class="col-count">协作中</th>
          <th>分享链接（局域网）</th>
          <th class="col-actions">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="6">
            <EmptyState hint="成员、分享链接与网络分享面板将在 m4 接入" title="成员列表为空" />
          </td>
        </tr>
      </tbody>
    </table>
    <p class="hint-line">「重置」会使旧链接立即失效并生成新链接；「吊销」后该成员无法再访问。链接仅包含身份 token，不包含任何任务数据。</p>
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

.flex-spacer {
  flex: 1;
}

.btn {
  font: inherit;
  font-size: 12px;
  border-radius: 7px;
  padding: 5px 12px;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text);
}

.btn.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.mem-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  font-size: 12.5px;
}

.mem-table th {
  text-align: left;
  font-size: 11px;
  color: var(--text-faint);
  font-weight: 500;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-panel);
}

.mem-table td {
  padding: 10px 12px;
}

.col-member {
  width: 180px;
}

.col-count {
  width: 80px;
}

.col-actions {
  width: 110px;
}

.hint-line {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 10px;
}
</style>
