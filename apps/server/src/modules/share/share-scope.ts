import type { Task } from "@ztask/shared";
import type { MemberFile } from "../members/member-service.js";
import type { TaskAggregate } from "../../storage/task-types.js";

/**
 * 成员相关集合（07 §5.1）：主任务 owner/collaborator 或任一可见小任务的被分配者。
 * 软删除任务不进入成员范围。
 */
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
      owner: summary(members, aggregate.assignments.find((a) => a.taskId === sub.id && a.kind === "owner")?.memberId ?? sub.id),
      progress: sub.progress,
      importance: sub.importance,
      dueDate: sub.dueDate,
      version: aggregate.taskVersion,
    })),
  };
}

/**
 * 成员可见的任务夹树（05 §6.11）：只含相关任务及祖先节点，计数按成员任务口径。
 * @param folders 任务夹实体。
 * @param aggregates 全部聚合。
 * @param memberId 当前成员。
 * @returns 成员可见树节点数组。
 */
export function buildMemberTree(
  folders: Array<{ id: string; parentId: string | null; name: string; position: number }>,
  aggregates: TaskAggregate[],
  memberId: string,
): unknown[] {
  const visibleFolders = new Set<string>();
  const tasksByFolder = new Map<string, Array<{ id: string; description: string; progress: number; importance: string }>>();
  for (const aggregate of aggregates) {
    if (aggregate.task.deletedAt !== null) continue;
    if (!isRelated(aggregate, memberId).related) continue;
    visibleFolders.add(aggregate.task.folderId);
    const list = tasksByFolder.get(aggregate.task.folderId) ?? [];
    list.push({
      id: aggregate.taskId,
      description: aggregate.task.description,
      progress: aggregate.task.progress,
      importance: aggregate.task.importance,
    });
    tasksByFolder.set(aggregate.task.folderId, list);
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const folderId of [...visibleFolders]) {
    let cursor = byId.get(folderId);
    while (cursor?.parentId) {
      visibleFolders.add(cursor.parentId);
      cursor = byId.get(cursor.parentId);
    }
  }

  type TreeNode = { id: string; parentId: string | null; name: string; position: number; children: TreeNode[]; tasks: unknown[]; counts: { done: number; todo: number } };
  const childrenOf = new Map<string | null, TreeNode[]>();
  for (const folder of folders) {
    if (!visibleFolders.has(folder.id)) continue;
    const tasks = tasksByFolder.get(folder.id) ?? [];
    const done = tasks.filter((task) => task.progress >= 100).length;
    const list = childrenOf.get(folder.parentId) ?? [];
    list.push({ id: folder.id, parentId: folder.parentId, name: folder.name, position: folder.position, children: [], tasks, counts: { done, todo: tasks.length - done } });
    childrenOf.set(folder.parentId, list);
  }
  function attach(nodes: TreeNode[]): TreeNode[] {
    for (const node of nodes) node.children = attach(childrenOf.get(node.id) ?? []);
    return nodes.sort((a, b) => a.position - b.position);
  }
  return attach(childrenOf.get(null) ?? []);
}
