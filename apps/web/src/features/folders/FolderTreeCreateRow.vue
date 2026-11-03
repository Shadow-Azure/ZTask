<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";
import { describeApiError } from "../../api/error-message";

/**
 * 树内「新建任务夹」行（原型 172–173、1120–1121）：渲染在**当前选中夹**的 `.tchildren`
 * 末尾（📁 前缀 + 12.5px 行内输入，宽度随树宽 flex 撑满，原型实测 260px）。
 * 入口按钮仍在树头（原型 599–602，TrackerView 承载）；点击后按钮不消失，行落在选中夹子层。
 * Enter 创建到该夹之下、Esc（原型 1080–1090）与失焦（1091）取消；创建成功后关闭并刷新树。
 * 成员只读域不渲染本组件，因此 share 作用域不会注册任何写 mutation（03 §5、08 §6.3）。
 */
const props = defineProps<{
  /** 新夹的父夹 id；null 表示建到树根（web 独有态：树为空/管理端未选中夹时）。 */
  parentId: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

const queryClient = useQueryClient();
const toast = useToast();
const newName = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

const createMutation = useMutation({
  mutationFn: (input: { name: string; parentId: string | null }) => adminApi.createFolder(input),
  onSuccess: (folder) => {
    newName.value = "";
    void queryClient.invalidateQueries({ queryKey: ["admin", "folders"] });
    toast.show(`已创建任务夹「${folder.name}」`);
    emit("close");
  },
  onError: (cause: unknown) => {
    toast.show(describeApiError(cause, "创建失败"));
  },
});

function submitCreate(): void {
  const name = newName.value.trim();
  if (!name || createMutation.isPending.value) return;
  createMutation.mutate({ name, parentId: props.parentId });
}

/** 原型 1091：失焦即取消；提交中不关闭，避免草稿与失败提示一起丢失。 */
function onBlur(): void {
  if (!createMutation.isPending.value) emit("close");
}

/** 原型 1082–1083：行一出现就聚焦。 */
onMounted(() => inputEl.value?.focus());
</script>

<template>
  <li class="tree-input">
    <span class="chev-slot" aria-hidden="true" />📁
    <input
      ref="inputEl"
      v-model="newName"
      class="create-input"
      placeholder="任务夹名称，Enter 确认 / Esc 取消"
      aria-label="新任务夹名称"
      @keydown.enter="submitCreate"
      @keydown.escape="emit('close')"
      @blur="onBlur"
    >
  </li>
</template>

<style scoped>
/* 原型 172：行容器 3px 8px 内距 + 6px 间距；字号继承正文 13px（图标按 13px 渲染）。 */
.tree-input {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  list-style: none;
}

/* 原型 1121 的 `<span class="chev"></span>` 在 `.tree-input` 内无宽度规则，仅占一个 flex 间距；
 * 这里用零宽占位保持与原型相同的输入框起点（x=64）。 */
.chev-slot {
  width: 0;
  flex: none;
}

/* 原型 173：12.5px、蓝描边、6px 圆角、3px 8px 内距；宽度由 flex 撑满（树宽 340 时实测 260px）。 */
.create-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 12.5px;
  border: 1px solid var(--blue);
  border-radius: 6px;
  padding: 3px 8px;
  background: var(--bg-card);
  outline: none;
}
</style>
