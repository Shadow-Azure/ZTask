import type { Importance } from "@ztask/shared";

/** 小任务的只读展示行。 */
export interface TaskCardSubtask {
  id: string;
  description: string;
  progress: number;
  /** 负责人显示名（可选；无负责人时显示待分配）。 */
  ownerName?: string;
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
  owners: string[];
  importance: Importance;
  /** YYYY-MM-DD 或 null。 */
  dueDate: string | null;
  progress: number;
  detail: string;
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
