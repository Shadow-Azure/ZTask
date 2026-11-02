<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember, Task } from "@ztask/shared";
import { adminTaskApi } from "../../api/admin";
import BaseDialog from "../../components/ui/BaseDialog.vue";
import ImportanceMark from "../../components/ui/ImportanceMark.vue";
import { useToast } from "../../components/ui/toast";

/**
 * 任务编辑浮窗（08 §3）：新建与编辑共用；
 * 草稿深拷贝、字段级校验、小任务增改删（clientId）、409 保留草稿并可重试。
 */
const props = defineProps<{
  open: boolean;
  /** 新建时的目标任务夹。 */
  folderId: string | null;
  /** 编辑目标；null 为新建。 */
  task: Task | null;
  /** 活跃成员（分配选择器数据源）。 */
  members: AdminMember[];
}>();

const emit = defineEmits<{ close: []; saved: [task: Task] }>();

const queryClient = useQueryClient();
const toast = useToast();

interface DraftSubtask {
  clientId: string;
  id?: string;
  description: string;
  ownerId: string;
  progress: number;
  importance: "high" | "mid" | "low";
  dueDate: string | null;
}

const description = ref("");
const ownerIds = ref<string[]>([]);
const collaboratorIds = ref<string[]>([]);
const progress = ref(0);
const detail = ref("");
const importance = ref<"high" | "mid" | "low">("mid");
const dueDate = ref("");
const subtasks = ref<DraftSubtask[]>([]);
const descriptionError = ref("");
const conflict = ref(false);

const isEdit = computed(() => props.task !== null);
const saving = computed(() => saveMutation.isPending.value);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    conflict.value = false;
    descriptionError.value = "";
    if (props.task) {
      const task = props.task;
      description.value = task.description;
      ownerIds.value = task.owners.map((member) => member.id);
      collaboratorIds.value = task.collaborators.map((member) => member.id);
      progress.value = task.progress;
      detail.value = task.detail;
      importance.value = task.importance;
      dueDate.value = task.dueDate ?? "";
      subtasks.value = task.subtasks.map((sub) => ({
        clientId: sub.id,
        id: sub.id,
        description: sub.description,
        ownerId: sub.owner.id,
        progress: sub.progress,
        importance: sub.importance,
        dueDate: sub.dueDate,
      }));
    } else {
      description.value = "";
      ownerIds.value = [];
      collaboratorIds.value = [];
      progress.value = 0;
      detail.value = "";
      importance.value = "mid";
      dueDate.value = "";
      subtasks.value = [];
    }
  },
  { immediate: true },
);

function toggleMember(role: "owner" | "collaborator", memberId: string): void {
  const own = role === "owner";
  const ownList = own ? ownerIds : collaboratorIds;
  const otherList = own ? collaboratorIds : ownerIds;
  if (ownList.value.includes(memberId)) {
    ownList.value = ownList.value.filter((id) => id !== memberId);
  } else {
    // 同一成员不能同时是 owner 与 collaborator（08 §3.1 互斥）
    otherList.value = otherList.value.filter((id) => id !== memberId);
    ownList.value = [...ownList.value, memberId];
  }
}

function addSubtask(): void {
  subtasks.value.push({
    clientId: `client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    description: "",
    ownerId: ownerIds.value[0] ?? "",
    progress: 0,
    importance: "mid",
    dueDate: null,
  });
}

function removeSubtask(clientId: string): void {
  subtasks.value = subtasks.value.filter((sub) => sub.clientId !== clientId);
}

const saveMutation = useMutation({
  mutationFn: async () => {
    if (!description.value.trim()) throw new Error("任务描述不能为空");
    if (ownerIds.value.length === 0) throw new Error("至少选择一名负责人");
    if (isEdit.value && props.task) {
      return await adminTaskApi.saveEditor(props.task.id, {
        version: props.task.version,
        task: {
          description: description.value.trim(),
          ownerIds: ownerIds.value,
          collaboratorIds: collaboratorIds.value,
          progress: progress.value,
          detail: detail.value,
          importance: importance.value,
          dueDate: dueDate.value || null,
        },
        subtasks: {
          create: subtasks.value.filter((sub) => !sub.id).map((sub) => ({
            clientId: sub.clientId,
            description: sub.description.trim(),
            ownerId: sub.ownerId,
            progress: sub.progress,
            importance: sub.importance,
            dueDate: sub.dueDate,
          })),
          update: subtasks.value.filter((sub) => sub.id).map((sub) => ({
            id: sub.id,
            description: sub.description.trim(),
            ownerId: sub.ownerId,
            progress: sub.progress,
            importance: sub.importance,
            dueDate: sub.dueDate,
          })),
          deleteIds: [],
        },
      });
    }
    return await adminTaskApi.create({
      folderId: props.folderId,
      parentId: null,
      description: description.value.trim(),
      ownerIds: ownerIds.value,
      collaboratorIds: collaboratorIds.value,
      progress: progress.value,
      detail: detail.value,
      importance: importance.value,
      dueDate: dueDate.value || null,
    });
  },
  onSuccess: (result) => {
    const task = "task" in result ? result.parent : (result as Task);
    void queryClient.invalidateQueries({ queryKey: ["admin", "tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "folders"] });
    toast.show(props.task ? "任务已保存" : "任务已创建");
    emit("saved", task);
    emit("close");
  },
  onError: (cause: unknown) => {
    const status = (cause as { statusCode?: number }).statusCode;
    if (status === 409) {
      conflict.value = true;
      return;
    }
    toast.show(cause instanceof Error ? cause.message : "保存失败");
  },
});

function save(): void {
  if (!description.value.trim()) {
    descriptionError.value = "任务描述不能为空";
    return;
  }
  descriptionError.value = "";
  saveMutation.mutate();
}

/** 409 后按最新版本重试（保留草稿文本）。 */
function retryWithLatest(): void {
  void (async () => {
    if (!props.task) return;
    const detail = await adminTaskApi.get(props.task.id);
    const latest = "task" in detail ? detail.parent : detail;
    saveMutation.mutate();
    void latest;
  })();
}

const deleteMutation = useMutation({
  mutationFn: async () => {
    if (!props.task) return;
    return await adminTaskApi.remove(props.task.id, props.task.version);
  },
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "folders"] });
    toast.show("任务已删除");
    emit("close");
  },
  onError: (cause: unknown) => {
    const status = (cause as { statusCode?: number }).statusCode;
    if (status === 409) {
      conflict.value = true;
      return;
    }
    toast.show(cause instanceof Error ? cause.message : "删除失败");
  },
});

const confirmDelete = ref(false);
</script>

<template>
  <BaseDialog :open="open" :title="isEdit ? '任务详情' : '新建任务'" @close="emit('close')">
    <div v-if="conflict" class="conflict" role="alert">
      <span>服务器已有新版本；你的草稿已保留。</span>
      <button class="btn ghost" type="button" @click="retryWithLatest">基于最新版本重试</button>
    </div>

    <input v-model="description" class="desc-input" placeholder="任务描述…" aria-label="任务描述">
    <p v-if="descriptionError" class="field-error">{{ descriptionError }}</p>

    <div class="grid">
      <div class="m-field">
        <label>负责人（可多选）</label>
        <div class="msel">
          <button
            v-for="member in members"
            :key="member.id"
            type="button"
            class="mchip"
            :class="{ on: ownerIds.includes(member.id) }"
            @click="toggleMember('owner', member.id)"
          >{{ member.name }}</button>
        </div>
      </div>
      <div class="m-field">
        <label>协作人员（可多选）</label>
        <div class="msel">
          <button
            v-for="member in members"
            :key="member.id"
            type="button"
            class="mchip"
            :class="{ on: collaboratorIds.includes(member.id) }"
            @click="toggleMember('collaborator', member.id)"
          >{{ member.name }}</button>
        </div>
      </div>
      <div class="m-field">
        <label>重要度</label>
        <div class="seg">
          <button
            v-for="level in ['high', 'mid', 'low'] as const"
            :key="level"
            type="button"
            :class="{ on: importance === level }"
            @click="importance = level"
          >{{ level === "high" ? "高" : level === "mid" ? "中" : "低" }}</button>
        </div>
      </div>
      <div class="m-field">
        <label for="editor-due">预计完成时间</label>
        <input id="editor-due" v-model="dueDate" type="date">
      </div>
      <div class="m-field" style="grid-column: 1 / -1">
        <label for="editor-progress">任务进度 {{ progress }}%</label>
        <input id="editor-progress" v-model.number="progress" type="range" min="0" max="100" step="5">
      </div>
    </div>

    <div class="sec-title">任务进展详情</div>
    <textarea v-model="detail" class="detail-input" placeholder="记录当前进展、阻塞点、下一步计划…" />

    <div class="sec-title">小任务 <span class="rule">小任务用于拆解执行步骤，不可再向下嵌套</span></div>
    <div v-for="sub in subtasks" :key="sub.clientId" class="sub-row">
      <input v-model="sub.description" class="sub-desc" placeholder="小任务描述…">
      <select v-model="sub.ownerId" class="sub-owner" aria-label="小任务负责人">
        <option value="" disabled>负责人</option>
        <option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }}</option>
      </select>
      <input v-model.number="sub.progress" type="number" min="0" max="100" step="5" class="sub-progress" aria-label="小任务进度">
      <button class="icon-btn" type="button" title="移除小任务" @click="removeSubtask(sub.clientId)">✕</button>
    </div>
    <div class="sub-add">
      <button class="btn ghost" type="button" @click="addSubtask">＋ 添加小任务</button>
    </div>

    <template #foot>
      <button v-if="isEdit" class="del" type="button" @click="confirmDelete = true">删除任务</button>
      <span class="sp" />
      <button class="btn ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn primary" type="button" :disabled="saving" @click="save">
        {{ saving ? "保存中…" : "保存" }}
      </button>
    </template>
  </BaseDialog>

  <BaseDialog :open="confirmDelete" title="删除任务" @close="confirmDelete = false">
    <p class="confirm-text">删除任务将同时软删除其全部小任务；历史记录保留，此操作可在数据目录中追溯。</p>
    <template #foot>
      <span class="sp" />
      <button class="btn ghost" type="button" @click="confirmDelete = false">取消</button>
      <button class="btn danger-btn" type="button" :disabled="deleteMutation.isPending.value" @click="deleteMutation.mutate()">
        {{ deleteMutation.isPending.value ? "删除中…" : "确认删除" }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.conflict {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid color-mix(in srgb, var(--orange) 40%, var(--border));
  background: color-mix(in srgb, var(--orange) 8%, var(--bg-card));
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--orange);
  margin-bottom: 12px;
}

.desc-input {
  width: 100%;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-card);
  color: var(--text);
}

.field-error {
  font-size: 11px;
  color: var(--red);
  margin-top: 4px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.m-field label {
  display: block;
  font-size: 11px;
  color: var(--text-faint);
  margin-bottom: 4px;
}

.msel,
.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.mchip,
.seg button {
  font: inherit;
  font-size: 11.5px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-dim);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
}

.mchip.on {
  color: var(--blue);
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 8%, var(--bg-card));
}

.seg button.on {
  color: #fff;
  background: var(--blue);
  border-color: var(--blue);
}

.sec-title {
  font-size: 12px;
  font-weight: 600;
  margin: 14px 0 6px;
}

.rule {
  font-weight: 400;
  font-size: 10.5px;
  color: var(--text-faint);
  margin-left: 6px;
}

.detail-input {
  width: 100%;
  min-height: 88px;
  font: inherit;
  font-size: 12.5px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 8px 10px;
  background: var(--bg-card);
  color: var(--text);
  resize: vertical;
}

.sub-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: center;
}

.sub-desc {
  flex: 1;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 4px 8px;
  background: var(--bg-card);
  color: var(--text);
}

.sub-owner {
  font: inherit;
  font-size: 11.5px;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 4px 6px;
  background: var(--bg-card);
  color: var(--text);
}

.sub-progress {
  width: 64px;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 4px 6px;
  background: var(--bg-card);
  color: var(--text);
}

.sub-add {
  margin-top: 4px;
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

.btn.danger-btn {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.del {
  font: inherit;
  font-size: 12.5px;
  border: none;
  background: transparent;
  color: var(--red);
  cursor: pointer;
  padding: 0;
}

.del:hover {
  text-decoration: underline;
}

.icon-btn {
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}

.icon-btn:hover {
  color: var(--red);
  background: var(--bg-inset);
}

.sp {
  flex: 1;
}

.confirm-text {
  font-size: 12.5px;
  color: var(--text-dim);
}
</style>
