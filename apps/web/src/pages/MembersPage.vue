<script setup lang="ts">
import { ref } from "vue";
import MemberTable from "../features/members/MemberTable.vue";
import NetworkSharePanel from "../features/members/NetworkSharePanel.vue";

/**
 * 成员管理页（08 §5，仅管理员，原型 members-body / 681–695）：
 * 标题行（「＋ 添加成员」在标题行右端，原型 682–687）+ 局域网分享面板 + 成员表格。
 * ShareLinkCell 报告 LAN 未开启时，聚焦/滚动到网络面板，先开启再生成链接。
 */
const networkPanel = ref<{ focus: () => void } | null>(null);
const memberTable = ref<{ openCreate: () => void } | null>(null);

/** 分享链接操作需要先开启 LAN：把注意力交给网络面板（08 §5 的引导流程）。 */
function focusNetworkPanel(): void {
  networkPanel.value?.focus();
}
</script>

<template>
  <div class="members-body">
    <!-- 原型 682–687：标题行 = h2 + 副说明 + spacer + 「＋ 添加成员」右端（D9）。 -->
    <div class="page-title-row">
      <h2>团队成员</h2>
      <span class="page-sub">成员通过各自的分享链接访问，仅能查看与更新和自己相关的事项</span>
      <span class="spacer" />
      <button class="btn primary" type="button" @click="memberTable?.openCreate()">＋ 添加成员</button>
    </div>
    <NetworkSharePanel ref="networkPanel" />
    <MemberTable ref="memberTable" @needs-network="focusNetworkPanel" />
    <p class="hint-line">
      「重置」会使旧链接立即失效并生成新链接；「吊销」后该成员无法再访问，可随时重新生成。
      链接仅包含身份 token，不包含任何任务数据；刷新后无法再次查看完整链接，只能重置。
    </p>
  </div>
</template>

<style scoped>
/* 原型 357：18/22/40 内距。 */
.members-body {
  padding: 18px 22px 40px;
}

/* 原型 376–378：标题行 baseline 对齐、h2 16px/700、副说明 12px。 */
.page-title-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 14px;
}

.page-title-row h2 {
  font-size: 16px;
  font-weight: 700;
}

.page-sub {
  font-size: 12px;
  color: var(--text-faint);
}

.page-title-row .spacer {
  flex: 1;
}

/* 原型 193–195：主按钮 12.5px/600、radius 8。 */
.btn.primary {
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  background: var(--blue);
  border: 1px solid var(--blue);
  color: #fff;
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
}

.btn.primary:hover {
  background: #2a63c8;
}

.hint-line {
  font-size: 11px;
  color: var(--text-faint);
  margin-top: 10px;
}
</style>
