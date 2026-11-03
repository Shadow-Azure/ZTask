import type { Importance, MemberSummary } from "@ztask/shared";

/** 小任务的只读展示行。 */
export interface TaskCardSubtask {
  id: string;
  description: string;
  progress: number;
  /** 负责人显示名（可选；无负责人时显示待分配）。 */
  ownerName?: string;
  /** 负责人成员色（可选；用于头像，缺省灰色）。 */
  ownerColor?: string;
}

/**
 * TaskCard 的展示模型（03 §5：TaskCard 始终只读，不接收 mutation 回调）。
 * 由调用方把服务端 DTO 映射为显示名，组件内部不做请求。
 */
export interface TaskCardModel {
  id: string;
  description: string;
  /** 任务夹路径显示（可选）。 */
  folderName?: string;
  /** 负责人摘要（含成员色，用于头像组）。 */
  owners: MemberSummary[];
  importance: Importance;
  /** YYYY-MM-DD 或 null。 */
  dueDate: string | null;
  progress: number;
  detail: string;
  /** 负责人筛选只命中子任务时为 true：subtasks 是裁剪后的子集。 */
  subtasksFiltered?: boolean;
  subtasks: TaskCardSubtask[];
}

/**
 * 逾期判定：有截止日、未完成且截止日早于今天（date-only 字符串可直接比较）。
 * @param model 任务卡展示模型。
 * @returns 已逾期为 true。
 */
export function isOverdue(model: Pick<TaskCardModel, "dueDate" | "progress">): boolean {
  if (model.dueDate === null || model.progress >= 100) return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return model.dueDate < todayIso;
}

/**
 * 已完成小任务数。
 * @param subtasks 小任务列表。
 * @returns progress ≥ 100 的数量。
 */
export function doneSubtaskCount(subtasks: TaskCardSubtask[]): number {
  return subtasks.filter((subtask) => subtask.progress >= 100).length;
}

/**
 * 截止日显示（原型 fmtD）：`YYYY-MM-DD` → `M-D`（mono 列宽友好）。
 * @param dueDate YYYY-MM-DD 或 null。
 * @returns 短日期；null 返回 null。
 */
export function formatDueShort(dueDate: string | null): string | null {
  if (dueDate === null) return null;
  const [, month, day] = dueDate.split("-");
  if (month === undefined || day === undefined) return dueDate;
  return `${Number(month)}-${day}`;
}
