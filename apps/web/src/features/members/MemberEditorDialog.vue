<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember } from "@ztask/shared";
import { adminApi } from "../../api/admin";
import { useToast } from "../../components/ui/toast";
import BaseDialog from "../../components/ui/BaseDialog.vue";
import { describeApiError } from "../../api/error-message";

/**
 * 成员添加/编辑浮窗（08 §5）：表单维护 name/role/color 与管理员权限；
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
const isAdmin = ref(false);
const nameError = ref("");

watch(
  () => props.open,
  (open) => {
    if (open) {
      name.value = props.member?.name ?? "";
      role.value = props.member?.role ?? "";
      color.value = props.member?.color ?? "#2f6fe0";
      isAdmin.value = props.member?.isAdmin === true;
      nameError.value = "";
    }
  },
);

const saving = computed(() => saveMutation.isPending.value);

const saveMutation = useMutation({
  mutationFn: (input: { name: string; role: string; color: string; isAdmin: boolean }) => {
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
    toast.show(describeApiError(cause, "保存失败"));
  },
});

function save(): void {
  const trimmed = name.value.trim();
  if (!trimmed) {
    nameError.value = "姓名不能为空";
    return;
  }
  nameError.value = "";
  saveMutation.mutate({ name: trimmed, role: role.value.trim(), color: color.value, isAdmin: isAdmin.value });
}
</script>

<template>
  <BaseDialog :open="open" :title="member ? '编辑成员' : '添加成员'" :width="440" @close="emit('close')">
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
    <div class="field admin-field">
      <label class="check-label" for="member-admin">
        <input id="member-admin" v-model="isAdmin" type="checkbox">
        <span>管理员权限</span>
      </label>
      <p class="field-hint">拥有管理员权限的成员，其分享链接会直接进入管理页，可管理任务、成员与分享设置。</p>
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

/* 原型 430：字段标签 11px/650、大写、0.4px 字距（此前只有 11px + faint，R4-D7）。 */
.field label {
  font-size: 11px;
  font-weight: 650;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

/* 原型 765/769 + 427：姓名/角色沿用 .m-desc-input 形态——13px/500、inset 灰底、radius 9、
 * 7/10 内距、透明描边；聚焦时蓝描边 + 白底（R3-D7）。 */
.text-input {
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 7px 10px;
  outline: none;
  background: var(--bg-inset);
}

.text-input:focus {
  border-color: var(--blue);
  background: var(--bg-card);
}

.color-input {
  width: 46px;
  height: 28px;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--bg-card);
  padding: 2px;
}

/* 管理员权限：保留普通文本标签，不沿用字段标签的大写/字距。 */
.field label.check-label {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text);
  text-transform: none;
  letter-spacing: 0;
  cursor: pointer;
}

.check-label input[type="checkbox"] {
  width: 15px;
  height: 15px;
  accent-color: var(--blue);
  cursor: pointer;
}

.field-hint {
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-faint);
}

.admin-field {
  padding: 10px 12px;
  background: var(--bg-inset);
  border-radius: 9px;
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
