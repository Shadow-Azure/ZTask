<script setup lang="ts">
/**
 * 成员管理页（08 §5，仅管理员，原型 members-body）：
 * 标题行 + 局域网分享面板 + 成员表格（分享链接生命周期在表格内）。
 * ShareLinkCell 报告 LAN 未开启时，聚焦/滚动到网络面板，先开启再生成链接。
 */
import { ref } from "vue";
import MemberTable from "../features/members/MemberTable.vue";
import NetworkSharePanel from "../features/members/NetworkSharePanel.vue";

const networkPanel = ref<{ focus: () => void } | null>(null);

/** 分享链接操作需要先开启 LAN：把注意力交给网络面板（08 §5 的引导流程）。 */
function focusNetworkPanel(): void {
  networkPanel.value?.focus();
}
</script>

<template>
  <div class="members-body">
    <div class="page-title-row">
      <h2>团队成员</h2>
      <span class="page-sub">成员通过各自的分享链接访问，仅能查看与更新和自己相关的事项</span>
    </div>
    <NetworkSharePanel ref="networkPanel" />
    <MemberTable @needs-network="focusNetworkPanel" />
    <p class="hint-line">
      「重置」会使旧链接立即失效并生成新链接；「吊销」后该成员无法再访问，可随时重新生成。
      链接仅包含身份 token，不包含任何任务数据；刷新后无法再次查看完整链接，只能重置。
    </p>
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
