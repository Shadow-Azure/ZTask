<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useMutation, useQueryClient } from "@tanstack/vue-query";
import type { AdminMember, FolderTreeNode, Task } from "@ztask/shared";
import { adminTaskApi } from "../../api/admin";
import { describeApiError } from "../../api/error-message";
import BaseDialog from "../../components/ui/BaseDialog.vue";
import { useToast } from "../../components/ui/toast";
import MemberMultiSelect from "./MemberMultiSelect.vue";

/**
 * 任务编辑浮窗（08 §3，原型 702–756/1578–1738）：
 * 新建与编辑共用；头部标题旁展示任务夹路径 mono 文本（新建模式 =「保存到」+ 任务夹下拉）；
 * 负责人/协作 = msel 多选下拉（头像 tag + 搜索 + 「已是负责人」禁选）；
 * 重要度 seg 选中态按级别着色；任务进度 = 全宽滑杆 + 右侧 14px mono 蓝色百分比；
 * 小任务行 = 色点 + 描述 + 负责人下拉 + 进度滑杆 + % + 预计完成日期输入 + ✕（D11）。
 * 草稿深拷贝、字段级校验、小任务增改删（clientId）、409 保留草稿并可重试。
 */
const props = defineProps<{
  open: boolean;
  /** 新建时的目标任务夹（作为「保存到」下拉的默认值）。 */
  folderId: string | null;
  /** 编辑目标；null 为新建。 */
  task: Task | null;
  /** 活跃成员（分配选择器数据源）。 */
  members: AdminMember[];
  /** 管理端任务夹树（新建模式「保存到」下拉的数据源）。 */
  folders: FolderTreeNode[];
  /** 编辑目标的任务夹完整路径（头部展示；新建模式不显示）。 */
  folderPath?: string;
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
/** 选填方案描述（m18-01）：随任务一起保存。 */
const plan = ref("");
const importance = ref<"high" | "mid" | "low">("mid");
const dueDate = ref("");
const subtasks = ref<DraftSubtask[]>([]);
const descriptionError = ref("");
const subtaskError = ref("");
const conflict = ref(false);
/** 新建模式的「保存到」目标任务夹。 */
const targetFolderId = ref("");

const isEdit = computed(() => props.task !== null);
const saving = computed(() => saveMutation.isPending.value);

/** 树展平为「id → 完整路径」选项（原型 1589：📁 + 全路径）。 */
const folderOptions = computed<Array<{ id: string; path: string }>>(() => {
  const out: Array<{ id: string; path: string }> = [];
  const walk = (nodes: FolderTreeNode[], trail: string[]): void => {
    for (const node of nodes) {
      const path = [...trail, node.name];
      out.push({ id: node.id, path: path.join(" / ") });
      walk(node.children ?? [], path);
    }
  };
  walk(props.folders, []);
  return out;
});

/** 负责人选择变化：被设为负责人的成员不再同时是协作人（08 §3.1 互斥）。 */
function setOwners(ids: string[]): void {
  ownerIds.value = ids;
  collaboratorIds.value = collaboratorIds.value.filter((id) => !ids.includes(id));
}

/** 协作选择变化：组件侧已对「已是负责人」禁选，这里直接接收。 */
function setCollaborators(ids: string[]): void {
  collaboratorIds.value = ids;
}

function collaboratorDisabledReason(member: AdminMember): string | null {
  return ownerIds.value.includes(member.id) ? "已是负责人" : null;
}

/** 新增小任务：默认负责人 = 第一位负责人，预计完成默认跟随主任务（原型 1733）。 */
const subInput = ref("");

function addSubtask(): void {
  const desc = subInput.value.trim();
  if (!desc) return;
  subtasks.value.push({
    clientId: `client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    description: desc,
    ownerId: ownerIds.value[0] ?? "",
    progress: 0,
    importance: importance.value,
    dueDate: dueDate.value || null,
  });
  subInput.value = "";
}

function removeSubtask(clientId: string): void {
  subtasks.value = subtasks.value.filter((sub) => sub.clientId !== clientId);
}

/** 用户修正小任务行后清除上一轮行内提示。 */
watch(subtasks, () => {
  if (subtaskError.value !== "") subtaskError.value = "";
}, { deep: true });

/** 小任务行级校验：描述、负责人、进度必须能在本地判断，避免把可预判错误发给服务端。 */
function validateSubtasks(): boolean {
  const blank = subtasks.value.findIndex((sub) => sub.description.trim() === "");
  if (blank >= 0) {
    subtaskError.value = `小任务第 ${blank + 1} 行描述不能为空`;
    return false;
  }
  const missingOwner = subtasks.value.findIndex((sub) => sub.ownerId === "");
  if (missingOwner >= 0) {
    subtaskError.value = `小任务「${subtasks.value[missingOwner]!.description.trim()}」还没有负责人，请选择负责人`;
    return false;
  }
  const badProgress = subtasks.value.findIndex(
    (sub) => !Number.isInteger(sub.progress) || sub.progress < 0 || sub.progress > 100,
  );
  if (badProgress >= 0) {
    subtaskError.value = `小任务「${subtasks.value[badProgress]!.description.trim()}」进度须为 0–100 的整数`;
    return false;
  }
  return true;
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    conflict.value = false;
    descriptionError.value = "";
    subtaskError.value = "";
    subInput.value = "";
    if (props.task) {
      const task = props.task;
      description.value = task.description;
      ownerIds.value = task.owners.map((member) => member.id);
      collaboratorIds.value = task.collaborators.map((member) => member.id);
      progress.value = task.progress;
      detail.value = task.detail;
      plan.value = task.plan ?? "";
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
      plan.value = "";
      importance.value = "mid";
      dueDate.value = "";
      subtasks.value = [];
    }
    // 「保存到」默认 = 当前任务夹；无选中时取首个任务夹（原型 1589 默认选中当前夹）。
    targetFolderId.value = props.folderId ?? folderOptions.value[0]?.id ?? "";
  },
  { immediate: true },
);

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
          plan: plan.value,
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
      folderId: targetFolderId.value || props.folderId || "",
      parentId: null,
      description: description.value.trim(),
      ownerIds: ownerIds.value,
      collaboratorIds: collaboratorIds.value,
      progress: progress.value,
      detail: detail.value,
      plan: plan.value,
      importance: importance.value,
      dueDate: dueDate.value || null,
      subtasks: {
        create: subtasks.value.map((sub) => ({
          clientId: sub.clientId,
          description: sub.description.trim(),
          ownerId: sub.ownerId,
          progress: sub.progress,
          importance: sub.importance,
          dueDate: sub.dueDate,
        })),
      },
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
    toast.show(describeApiError(cause, "保存失败"));
  },
});

function save(): void {
  if (!description.value.trim()) {
    descriptionError.value = "任务描述不能为空";
    return;
  }
  descriptionError.value = "";
  subtaskError.value = "";
  if (!validateSubtasks()) return;
  saveMutation.mutate();
}

/** 409 后按最新版本重试（保留草稿文本）。 */
function retryWithLatest(): void {
  void (async () => {
    if (!props.task) return;
    await adminTaskApi.get(props.task.id);
    saveMutation.mutate();
  })();
}

const deleteMutation = useMutation({
  mutationFn: async () => {
    if (!props.task) return;
    return await adminTaskApi.remove(props.task.id, props.task.version);
  },
  onSuccess: () => {
    confirmDelete.value = false;
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
    toast.show(describeApiError(cause, "删除失败"));
  },
});

const confirmDelete = ref(false);
</script>

<template>
  <BaseDialog :open="open" :title="isEdit ? '任务详情' : '新建任务'" :width="660" @close="emit('close')">
    <!-- D11（原型 704–708）：头部 = 标题 + 任务夹路径 mono（编辑）/「保存到」+ 夹下拉（新建）。 -->
    <template #head-extra>
      <span v-if="isEdit" class="modal-path">{{ folderPath }}</span>
      <template v-else>
        <label class="save-label" for="editor-folder">保存到</label>
        <select id="editor-folder" v-model="targetFolderId" class="folder-select">
          <option v-for="option in folderOptions" :key="option.id" :value="option.id">📁 {{ option.path }}</option>
        </select>
      </template>
    </template>

    <div v-if="conflict" class="conflict" role="alert">
      <span>服务器已有新版本；你的草稿已保留。</span>
      <button class="btn ghost" type="button" @click="retryWithLatest">基于最新版本重试</button>
    </div>

    <input v-model="description" class="desc-input" placeholder="任务描述…" aria-label="任务描述">
    <p v-if="descriptionError" class="field-error">{{ descriptionError }}</p>

    <div class="grid">
      <div class="m-field">
        <label>负责人（可多选）</label>
        <MemberMultiSelect
          :members="members"
          :model-value="ownerIds"
          placeholder="选择负责人…"
          aria-label="负责人"
          @update:model-value="setOwners"
        />
      </div>
      <div class="m-field">
        <label>协作人员（可多选）</label>
        <MemberMultiSelect
          :members="members"
          :model-value="collaboratorIds"
          placeholder="选择协作人员…"
          :disabled-reason="collaboratorDisabledReason"
          aria-label="协作人员"
          @update:model-value="setCollaborators"
        />
      </div>
      <div class="m-field">
        <label>重要度</label>
        <!-- D11（原型 457–459）：seg 选中态按级别着色（高红/中橙/低灰）。 -->
        <div class="seg">
          <button
            v-for="level in ['high', 'mid', 'low'] as const"
            :key="level"
            type="button"
            :class="importance === level ? `on ${level}` : ''"
            @click="importance = level"
          >{{ level === "high" ? "高" : level === "mid" ? "中" : "低" }}</button>
        </div>
      </div>
      <div class="m-field">
        <label for="editor-due">预计完成时间</label>
        <input id="editor-due" v-model="dueDate" type="date">
      </div>
      <div class="m-field wide">
        <label for="editor-progress">任务进度</label>
        <!-- D11（原型 462–464）：全宽滑杆 + 右侧 14px mono 蓝色百分比。 -->
        <div class="m-prog">
          <input id="editor-progress" v-model.number="progress" type="range" min="0" max="100" step="5">
          <span class="pv">{{ progress }}%</span>
        </div>
      </div>
    </div>

    <!-- m18-01（原型 946–947）：进度滑杆下方「方案描述」区块，选填多行文本。 -->
    <div class="sec-title">方案描述 <span class="rule">选填：记录实现思路、技术选型与拆解方案</span></div>
    <textarea v-model="plan" class="detail-input plan-input" placeholder="选填：记录本任务的实现方案…" aria-label="方案描述" />

    <div class="sec-title">任务进展详情</div>
    <textarea v-model="detail" class="detail-input" placeholder="记录当前进展、阻塞点、下一步计划…" />

    <div class="sec-title sec-subtasks">小任务 <span class="rule">小任务用于拆解执行步骤，不可再向下嵌套</span></div>
    <p v-if="subtaskError" class="field-error" role="alert">{{ subtaskError }}</p>
    <!-- D11（原型 469–477）：小任务行 = 色点 + 描述 + 负责人 + 滑杆 + % + 日期 + ✕。 -->
    <div class="sub-list">
      <div v-if="subtasks.length === 0" class="sub-item sub-empty-row">暂无小任务</div>
      <div v-for="(sub, index) in subtasks" :key="sub.clientId" class="sub-item">
        <span class="imp-dot" :class="sub.importance" title="小任务重要度跟随父任务" aria-hidden="true" />
        <input v-model="sub.description" class="sd" placeholder="小任务描述" :aria-label="`小任务 ${index + 1} 描述`">
        <select v-model="sub.ownerId" class="sub-owner" :aria-label="`小任务 ${index + 1} 负责人`">
          <option value="" disabled>负责人</option>
          <option v-for="member in members" :key="member.id" :value="member.id">{{ member.name }}</option>
        </select>
        <input v-model.number="sub.progress" type="range" min="0" max="100" step="5" class="sub-range" :aria-label="`小任务 ${index + 1} 进度`">
        <span class="sp">{{ sub.progress }}%</span>
        <input v-model="sub.dueDate" type="date" class="sub-due" :aria-label="`小任务 ${index + 1} 预计完成`">
        <button class="icon-btn danger" type="button" title="移除" @click="removeSubtask(sub.clientId)">✕</button>
      </div>
    </div>
    <div class="sub-add">
      <input
        v-model="subInput"
        placeholder="添加小任务，回车确认…"
        aria-label="新小任务描述"
        @keydown.enter="addSubtask"
      >
      <button class="btn ghost" type="button" @click="addSubtask">添加</button>
    </div>

    <template #foot>
      <button v-if="isEdit" class="del" type="button" @click="confirmDelete = true">删除任务</button>
      <span class="foot-sp" />
      <button class="btn ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn primary" type="button" :disabled="saving" @click="save">
        {{ saving ? "保存中…" : "保存" }}
      </button>
    </template>
  </BaseDialog>

  <BaseDialog :open="confirmDelete" title="删除任务" :width="400" @close="confirmDelete = false">
    <p class="confirm-text">删除任务将同时软删除其全部小任务；历史记录保留，此操作可在数据目录中追溯。</p>
    <template #foot>
      <span class="foot-sp" />
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

/* 原型 427–428：15px/650 描述输入，inset 底、透明描边，聚焦转白底蓝描边。 */
.desc-input {
  width: 100%;
  font: inherit;
  font-size: 15px;
  font-weight: 650;
  color: var(--text);
  border: 1px solid transparent;
  border-radius: 9px;
  padding: 7px 10px;
  outline: none;
  background: var(--bg-inset);
}

.desc-input:focus {
  border-color: var(--blue);
  background: var(--bg-card);
}

.field-error {
  font-size: 11px;
  color: var(--red);
  margin-top: 4px;
}

/* 原型 429–430：双列 grid、14/18 间距、上下 16 边距；label 11px/650 大写字距。 */
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 18px;
  margin: 16px 0;
}

.m-field label {
  display: block;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 6px;
}

.m-field.wide {
  grid-column: 1 / -1;
}

/* D11（原型 460–461）：日期输入 mono、描边 8px 圆角。 */
.m-field input[type="date"] {
  font: inherit;
  font-size: 12.5px;
  font-family: var(--mono);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 5px 10px;
  outline: none;
  width: 100%;
  background: var(--bg-card);
}

.m-field input[type="date"]:focus {
  border-color: var(--blue);
}

/* 原型 454–459：seg 描边分段的选中态按级别着色。 */
.seg {
  display: inline-flex;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  overflow: hidden;
}

.seg button {
  font: inherit;
  font-size: 12px;
  padding: 5px 16px;
  background: var(--bg-card);
  border: none;
  cursor: pointer;
  color: var(--text-dim);
}

.seg button + button {
  border-left: 1px solid var(--border);
}

.seg button.on.high {
  background: color-mix(in srgb, var(--red) 12%, transparent);
  color: var(--red);
  font-weight: 700;
}

.seg button.on.mid {
  background: color-mix(in srgb, var(--orange) 14%, transparent);
  color: var(--orange);
  font-weight: 700;
}

.seg button.on.low {
  background: color-mix(in srgb, #5a6372 13%, transparent);
  color: var(--text);
  font-weight: 700;
}

/* 原型 462–464：全宽进度滑杆 + 14px mono 蓝色百分比。 */
.m-prog {
  display: flex;
  align-items: center;
  gap: 10px;
}

.m-prog input[type="range"] {
  flex: 1;
  accent-color: var(--blue);
}

.m-prog .pv {
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 700;
  color: var(--blue);
  width: 44px;
  text-align: right;
}

/* 原型 467–468：区块标题 11px/650 大写字距 + 弱化规则说明。 */
.sec-title {
  font-size: 11px;
  font-weight: 650;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin: 4px 0 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.sec-subtasks {
  margin-top: 14px;
}

.rule {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text-faint);
  font-size: 10.5px;
}

/* 原型 465–466：详情 textarea 9/11 内距、最小 88 高。 */
.detail-input {
  width: 100%;
  min-height: 88px;
  font: inherit;
  font-size: 12.5px;
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  padding: 9px 11px;
  resize: vertical;
  outline: none;
  line-height: 1.6;
  background: var(--bg-card);
}

.detail-input:focus {
  border-color: var(--blue);
}

/* 原型 947：方案描述 textarea min-height 64px。 */
.plan-input {
  min-height: 64px;
}

/* 原型 469–477：小任务列表盒与行布局。 */
.sub-list {
  border: 1px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
  margin-bottom: 8px;
}

.sub-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-row);
  font-size: 12px;
}

.sub-item:last-child {
  border-bottom: none;
}

.sub-empty-row {
  color: var(--text-faint);
}

.imp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.imp-dot.high {
  background: var(--red);
}

.imp-dot.mid {
  background: var(--orange);
}

.imp-dot.low {
  background: var(--imp-low);
}

/* 原型 472–473：描述输入平时透明，hover/聚焦显描边。 */
.sub-item .sd {
  flex: 1;
  min-width: 0;
  font: inherit;
  font-size: 12px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 3px 7px;
  outline: none;
  background: transparent;
  color: var(--text);
}

.sub-item .sd:hover,
.sub-item .sd:focus {
  border-color: var(--border-strong);
  background: var(--bg-card);
}

.sub-owner {
  font: inherit;
  font-size: 11.5px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 4px;
  background: var(--bg-card);
}

.sub-range {
  width: 90px;
  accent-color: var(--blue);
}

.sp {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  width: 32px;
  text-align: right;
  flex: none;
}

.sub-due {
  font: inherit;
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 4px;
  width: 118px;
  background: var(--bg-card);
}

/* 原型 478–480：追加行 = 输入 + 添加按钮。 */
.sub-add {
  display: flex;
  gap: 8px;
}

.sub-add input {
  flex: 1;
  font: inherit;
  font-size: 12px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  padding: 6px 10px;
  outline: none;
  background: var(--bg-card);
  color: var(--text);
}

.sub-add input:focus {
  border-color: var(--blue);
}

/* 原型 425：编辑模式头部的 mono 路径。 */
.modal-path {
  font-size: 11px;
  color: var(--text-faint);
  font-family: var(--mono);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 原型 707–708：新建模式「保存到」标签 + mono 夹下拉。 */
.save-label {
  font-size: 11px;
  color: var(--text-faint);
  flex: none;
}

.folder-select {
  font: inherit;
  font-size: 11.5px;
  font-family: var(--mono);
  color: var(--text-dim);
  border: 1px solid var(--border-strong);
  border-radius: 7px;
  padding: 3px 6px;
  background: var(--bg-card);
  max-width: 240px;
}

.btn {
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  border: 1px solid transparent;
  background: var(--bg-card);
  color: var(--text);
}

.btn.primary {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

.btn.primary:hover {
  background: #2a63c8;
}

.btn.ghost {
  color: var(--text-dim);
  background: var(--bg-card);
  border-color: var(--border-strong);
}

.btn.ghost:hover {
  color: var(--text);
  background: var(--bg-inset);
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
  font-weight: 600;
  color: var(--red);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--red) 40%, transparent);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
}

.del:hover {
  background: color-mix(in srgb, var(--red) 8%, transparent);
}

.icon-btn {
  border: none;
  background: transparent;
  color: var(--text-faint);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  flex: none;
}

.icon-btn.danger:hover {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 10%, transparent);
}

.foot-sp {
  flex: 1;
}

.confirm-text {
  font-size: 12.5px;
  color: var(--text-dim);
}
</style>
