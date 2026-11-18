import type { ChangeKind, Importance, RevisionActor } from "@ztask/shared";

/**
 * 任务聚合的文件形态（06 §6/§7）。这些是持久化契约，不是 API DTO——
 * API 侧的 Task/Subtask 由 packages/shared 定义，序列化时映射。
 */

/** 聚合内主任务体；软删除走 deletedAt。 */
export interface TaskRecord {
  folderId: string;
  parentId: null;
  description: string;
  progress: number;
  detailText: string;
  /** 选填方案描述（m18-01）；旧数据/旧 revision 快照缺省视为空串。 */
  planText: string;
  importance: Importance;
  /** YYYY-MM-DD 或 null。 */
  dueDate: string | null;
  /** UTC RFC 3339。 */
  createdAt: string;
  deletedAt: string | null;
}

/** 聚合内小任务体；folderId 与主任务一致，不独立移动。 */
export interface SubtaskRecord {
  id: string;
  parentId: string;
  folderId: string;
  description: string;
  progress: number;
  importance: Importance;
  dueDate: string | null;
  createdAt: string;
  deletedAt: string | null;
}

/** 分配：taskId 指向主任务或某小任务；唯一性按 (taskId,memberId)。 */
export interface AssignmentRecord {
  taskId: string;
  memberId: string;
  kind: "owner" | "collaborator";
}

/** current.json 记录的最新 revision 指针，用于启动快路径校验（06 §6/§8.3）。 */
export interface RevisionTip {
  taskVersion: number;
  /** UTC RFC 3339。 */
  recordedAt: string;
  changeKind: ChangeKind;
  checksum: string;
}

/** 一个主任务聚合（current.json 内容）。 */
export interface TaskAggregate {
  formatVersion: number;
  taskId: string;
  taskVersion: number;
  /** UTC RFC 3339；最近一次有效变更时刻。 */
  updatedAt: string;
  revisionTip: RevisionTip;
  task: TaskRecord;
  subtasks: SubtaskRecord[];
  assignments: AssignmentRecord[];
}

/** revisions.jsonl 的一行（06 §7.1）：完整 post-change 快照 + 元数据 + checksum。 */
export interface RevisionLine {
  formatVersion: number;
  revisionId: string;
  taskId: string;
  taskVersion: number;
  /** UTC RFC 3339。 */
  recordedAt: string;
  changeKind: ChangeKind;
  actor: RevisionActor;
  checksum: string;
  snapshot: {
    task: TaskRecord;
    subtasks: SubtaskRecord[];
    assignments: AssignmentRecord[];
  };
}
