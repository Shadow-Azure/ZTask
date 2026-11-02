<script setup lang="ts">
import { computed } from "vue";
import TrackerView from "../features/tracker/TrackerView.vue";

/**
 * 事项跟踪页入口（08 §6.3，03 §5）：admin/readonly 访问模式与 admin/share 数据域显式声明并透传。
 * scope 决定 API 域与树/列表的 query key（05 §6.4/§6.11），不再依赖属性穿透的隐式转发。
 */
const props = defineProps<{
  /** 访问模式：readonly 不渲染任何写入口。 */
  access?: "admin" | "readonly";
  /** 数据域：share 走成员只读 API，绝不请求 /admin/**。 */
  scope?: "admin" | "share";
}>();

const access = computed(() => props.access ?? "admin");
const scope = computed(() => props.scope ?? "admin");
</script>

<template>
  <TrackerView :access="access" :scope="scope" />
</template>
