<script setup lang="ts">
import { RouterView } from "vue-router";
import ToastHost from "./components/ui/ToastHost.vue";

/**
 * 应用装配（08 §1）：路由出口 + 全局 toast；不预取全库任务，
 * 每个页面按自身权限域请求。分享会话等敏感态不进 query cache。
 */
</script>

<template>
  <RouterView />
  <ToastHost />
</template>
