import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FolderTreeNode, Task } from "@ztask/shared";
import type { MemberFile } from "../members/member-service.js";
import { readTaskAggregate } from "../../storage/task-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 小任务无 owner 时的展示摘要；与管理端 tasks 映射同口径（05 §6.5）。 */
const UNASSIGNED_SUMMARY = { id: "", name: "待分配", role: "", color: "#9aa2ae" } as const;

/**
 * 读取 tasks/ 下全部聚合（share 模块唯一入口，07 §5.1）。
 * 只扫描 UUID 目录；单个损坏聚合跳过，不让成员视图整体 500。
 * @param dataDir 数据目录。
 * @returns 任务聚合列表（不保证顺序）。
 */
export async function listTaskAggregates(dataDir: string): Promise<TaskAggregate[]> {
  let names: string[];
  try {
    names = await readdir(join(dataDir, "tasks"));
  } catch {
    return [];
  }
  const aggregates: TaskAggregate[] = [];
  for (const taskId of names.filter((name) => UUID_PATTERN.test(name))) {
    try {
      const aggregate = await readTaskAggregate(dataDir, taskId);
      if (aggregate) aggregates.push(aggregate);
    } catch {
      // 损坏的单个聚合按不可见处理（05 §7 不泄露存储细节）
    }
  }
  return aggregates;
}

/**
 * 成员相关集合（07 §5.1）：主任务 owner/collaborator 或任一可见小任务的被分配者。
 * 软删除任务不进入成员范围。
 * @param aggregates 全部聚合。
 * @param memberId 成员 ID。
 * @returns 只含该成员相关且未软删除的主任务聚合。
 */
export function memberVisibleAggregates(aggregates: TaskAggregate[], memberId: string): TaskAggregate[] {
  return aggregates.filter((aggregate) => aggregate.task.deletedAt === null && isRelated(aggregate, memberId).related);
}

/**
 * 判定聚合是否与成员相关（主任务 owner/collaborator 或可见小任务被分配者）。
 * @param aggregate 任务聚合。
 * @param memberId 成员 ID。
 * @returns related 与主任务角色。
 */
export function isRelated(aggregate: TaskAggregate, memberId: string): { related: boolean; role: "owner" | "collaborator" } {
  const mainAssignments = aggregate.assignments.filter((a) => a.taskId === aggregate.taskId);
  if (mainAssignments.some((a) => a.memberId === memberId && a.kind === "owner")) return { related: true, role: "owner" };
  if (mainAssignments.some((a) => a.memberId === memberId && a.kind === "collaborator")) return { related: true, role: "collaborator" };
  const subtaskAssignment = aggregate.assignments.find(
    (a) => a.memberId === memberId && a.taskId !== aggregate.taskId &&
      aggregate.subtasks.some((sub) => sub.id === a.taskId && sub.deletedAt === null),
  );
  if (subtaskAssignment) return { related: true, role: "collaborator" };
  return { related: false, role: "collaborator" };
}

/** 主任务 owner/collaborator 成员可见全部小任务；仅小任务被分配者只看自己的小任务。 */
function visibleSubtasks(aggregate: TaskAggregate, memberId: string): TaskAggregate["subtasks"] {
  if (mainOwnerOf(aggregate, memberId) || isMainCollaborator(aggregate, memberId)) {
    return aggregate.subtasks.filter((sub) => sub.deletedAt === null);
  }
  return aggregate.subtasks.filter(
    (sub) => sub.deletedAt === null && aggregate.assignments.some((a) => a.taskId === sub.id && a.memberId === memberId),
  );
}

function mainOwnerOf(aggregate: TaskAggregate, memberId: string): boolean {
  return aggregate.assignments.some((a) => a.taskId === aggregate.taskId && a.memberId === memberId && a.kind === "owner");
}

function isMainCollaborator(aggregate: TaskAggregate, memberId: string): boolean {
  return aggregate.assignments.some((a) => a.taskId === aggregate.taskId && a.memberId === memberId && a.kind === "collaborator");
}

function summary(members: Map<string, MemberFile>, id: string) {
  const file = members.get(id);
  return { id, name: file?.name ?? "待分配", role: file?.role ?? "", color: file?.color ?? "#9aa2ae" };
}

/**
 * 小任务 owner 摘要：无 owner 分配时给「待分配」，绝不用 sub.id 冒充成员 ID。
 * @param aggregate 任务聚合。
 * @param subtaskId 小任务 ID。
 * @param members 成员档案映射。
 * @returns 成员摘要。
 */
function subtaskOwner(aggregate: TaskAggregate, subtaskId: string, members: Map<string, MemberFile>) {
  const ownerId = aggregate.assignments.find((a) => a.taskId === subtaskId && a.kind === "owner")?.memberId;
  return ownerId === undefined ? { ...UNASSIGNED_SUMMARY } : summary(members, ownerId);
}

/**
 * 成员视角的任务 DTO：小任务按可见性过滤，owner 摘要来自成员档案（待分配兜底）。
 * @param aggregate 任务聚合。
 * @param memberId 成员 ID。
 * @param members 成员档案映射。
 * @returns 任务 DTO。
 */
export function toMemberTask(aggregate: TaskAggregate, memberId: string, members: Map<string, MemberFile>): Task {
  return {
    id: aggregate.taskId,
    folderId: aggregate.task.folderId,
    parentId: null,
    description: aggregate.task.description,
    owners: aggregate.assignments.filter((a) => a.taskId === aggregate.taskId && a.kind === "owner").map((a) => summary(members, a.memberId)),
    collaborators: aggregate.assignments.filter((a) => a.taskId === aggregate.taskId && a.kind === "collaborator").map((a) => summary(members, a.memberId)),
    progress: aggregate.task.progress,
    detail: aggregate.task.detailText,
    importance: aggregate.task.importance,
    dueDate: aggregate.task.dueDate,
    version: aggregate.taskVersion,
    createdAt: aggregate.task.createdAt,
    updatedAt: aggregate.updatedAt,
    subtasks: visibleSubtasks(aggregate, memberId).map((sub) => ({
      id: sub.id,
      parentId: aggregate.taskId,
      description: sub.description,
      owner: subtaskOwner(aggregate, sub.id, members),
      progress: sub.progress,
      importance: sub.importance,
      dueDate: sub.dueDate,
      version: aggregate.taskVersion,
    })),
  };
}

/**
 * 裁剪成员树（05 §6.11）：folder-service 产出与管理端同构的 FolderTreeNode[]，
 * 但管理端会保留空任务夹；成员树只保留含相关任务的节点及其祖先。
 * @param nodes 同构任务夹树。
 * @returns 裁剪后的任务夹树。
 */
export function pruneMemberTree(nodes: FolderTreeNode[]): FolderTreeNode[] {
  const kept: FolderTreeNode[] = [];
  for (const node of nodes) {
    const children = pruneMemberTree(node.children);
    if (node.tasks.length === 0 && children.length === 0) continue;
    kept.push({ ...node, children });
  }
  return kept;
}
