<script setup lang="ts">
import { computed } from "vue";
import TrackerView from "../features/tracker/TrackerView.vue";

/**
 * 事项跟踪页入口：admin/readonly 访问模式透传给 TrackerView。
 */
const props = defineProps<{ access?: "admin" | "readonly" }>();

const access = computed(() => props.access ?? "admin");
</script>

<template>
  <TrackerView :access="access" />
</template>
