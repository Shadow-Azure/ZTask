import type { Task } from "@ztask/shared";
import type { MemberFile } from "../members/member-service.js";
import { readAllTaskAggregates } from "../../storage/task-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";

/** 小任务无 owner 时的展示摘要；与管理端 tasks 映射同口径（05 §6.5）。 */
const UNASSIGNED_SUMMARY = { id: "", name: "待分配", role: "", color: "#9aa2ae" } as const;

/**
 * 读取全部主任务聚合（share 模块唯一入口，07 §5.1）。
 * 底层 SQLite 查询；单个损坏聚合由存储层跳过，不让成员视图整体 500。
 * @param dataDir 数据目录。
 * @returns 任务聚合列表。
 */
export async function listTaskAggregates(dataDir: string): Promise<TaskAggregate[]> {
  return await readAllTaskAggregates(dataDir);
}

/**
 * 全团队可见集合：成员链接展示与管理端相同的主任务范围，仅排除软删除。
 * @param aggregates 全部聚合。
 * @returns 未软删除的主任务聚合。
 */
export function activeAggregates(aggregates: TaskAggregate[]): TaskAggregate[] {
  return aggregates.filter((aggregate) => aggregate.task.deletedAt === null);
}

/**
 * 主任务分配角色（07 §5.1「个人页分组按主任务分配」）。
 *
 * 这是「主任务维度」的唯一判定：只有主任务 owner/collaborator 返回角色，
 * 仅被分配小任务的成员返回 null（subtask-only）。个人页分组用它：
 * 这类任务归入「其他成员的任务」，不会误进 owned/collaborated。
 * @param aggregate 任务聚合。
 * @param memberId 成员 ID。
 * @returns 主任务角色；无主任务分配为 null。
 */
export function mainAssignmentRole(aggregate: TaskAggregate, memberId: string): "owner" | "collaborator" | null {
  const mainAssignments = aggregate.assignments.filter((a) => a.taskId === aggregate.taskId);
  if (mainAssignments.some((a) => a.memberId === memberId && a.kind === "owner")) return "owner";
  if (mainAssignments.some((a) => a.memberId === memberId && a.kind === "collaborator")) return "collaborator";
  return null;
}

/** 全员可见范围下，每个任务展示全部未删除小任务。 */
function visibleSubtasks(aggregate: TaskAggregate): TaskAggregate["subtasks"] {
  return aggregate.subtasks.filter((sub) => sub.deletedAt === null);
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
 * 成员视角的任务 DTO：全员可见，因此保留完整描述、进展详情与全部未删除小任务；
 * owner 摘要来自成员档案（待分配兜底）。
 * @param aggregate 任务聚合。
 * @param members 成员档案映射。
 * @returns 任务 DTO。
 */
export function toMemberTask(aggregate: TaskAggregate, members: Map<string, MemberFile>): Task {
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
    subtasks: visibleSubtasks(aggregate).map((sub) => ({
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
