<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";
import BaseDialog from "../../components/ui/BaseDialog.vue";

/**
 * 成员添加/编辑浮窗（08 §5）：表单只维护 name/role/color；
 * 校验错误靠近字段显示；保存成功后失效成员列表查询。
 */
const props = defineProps<{
  open: boolean;
  /** 编辑目标；null 表示新增。 */
  member: AdminMember | null;
}>();

const emit = defineEmits<{ close: [] }>();

const queryClient = useQueryClient();
const toast = useToast();

const name = ref("");
const role = ref("");
const color = ref("#2f6fe0");
const nameError = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = props.member?.name ?? "";
      role.value = props.member?.role ?? "";
      color.value = props.member?.color ?? "#2f6fe0";
      nameError.value = "";
    }
  },
);

const saving = computed(() => saveMutation.isPending.value);

const saveMutation = useMutation({
  mutationFn: (input: { name: string; role: string; color: string }) => {
    if (props.member) {
      return adminApi.updateMember(props.member.id, input);
    }
    return adminApi.createMember(input);
  },
  onSuccess: (member) => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "members"] });
    toast.show(props.member ? `已更新「${member.name}」` : `已添加「${member.name}」`);
    emit("close");
  },
  onError: (cause: unknown) => {
    toast.show(cause instanceof Error ? cause.message : "保存失败");
  },
});

function save(): void {
  const trimmed = name.value.trim();
  if (!trimmed) {
    nameError.value = "姓名不能为空";
    return;
  }
  nameError.value = "";
  saveMutation.mutate({ name: trimmed, role: role.value.trim(), color: color.value });
}
</script>

<template>
  <BaseDialog :open="open" :title="member ? '编辑成员' : '添加成员'" @close="emit('close')">
    <div class="field">
      <label for="member-name">姓名</label>
      <input id="member-name" v-model="name" class="text-input" placeholder="成员姓名…">
      <p v-if="nameError" class="field-error">{{ nameError }}</p>
    </div>
    <div class="field">
      <label for="member-role">角色 / 备注</label>
      <input id="member-role" v-model="role" class="text-input" placeholder="如：前端工程师">
    </div>
    <div class="field">
      <label for="member-color">显示颜色</label>
      <input id="member-color" v-model="color" type="color" class="color-input">
    </div>

    <template #foot>
      <span class="sp" />
      <button class="btn ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn primary" type="button" :disabled="saving" @click="save">
        {{ saving ? "保存中…" : "保存" }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}

.field label {
  font-size: 11px;
  color: var(--text-faint);
}

.text-input {
  font: inherit;
  font-size: 13px;
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 6px 10px;
  background: var(--bg-card);
  color: var(--text);
}

.color-input {
  width: 46px;
  height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-card);
  padding: 2px;
}

.field-error {
  font-size: 11px;
  color: var(--red);
}

.btn {
  font: inherit;
  font-size: 12.5px;
  border-radius: 7px;
  padding: 6px 14px;
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

.btn.ghost {
  border-color: transparent;
  color: var(--text-dim);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.sp {
  flex: 1;
}
</style>
