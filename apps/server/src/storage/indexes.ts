import type { TaskAggregate } from "./task-types.js";

/**
 * 派生索引（06 §9）：只服务查询、可随时从 current 文件与实体文件重建，
 * 不是第二份权威数据；损坏/过期都通过 rebuild 恢复。
 */

/** 派生索引集合；键缺省表示"无对应条目"。 */
export interface DerivedIndexes {
  /** 主任务聚合，按 taskId。 */
  byId: Map<string, TaskAggregate>;
  /** 任务夹层级：parentId → 子任务夹 ID 列表；根夹键为 null。 */
  folderChildren: Map<string | null, string[]>;
  /** 未删除任务按 folderId。 */
  activeTasksByFolder: Map<string, string[]>;
  /** 含软删除任务按 folderId（历史口径）。 */
  historyTasksByFolder: Map<string, string[]>;
  /** 成员相关任务（含主/小任务）：memberId → taskId 列表。 */
  assignmentsByMember: Map<string, string[]>;
  /** 主任务的当前有效 owner：taskId → memberId 列表（已归档成员被剔除）。 */
  activeOwnersByTask: Map<string, string[]>;
}

function pushIndex<K extends string | null>(map: Map<K, string[]>, key: K, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * 从聚合与任务夹实体重建全部派生索引。纯函数：输入决定输出，便于口径单测（04 §7）。
 * @param input 索引输入（聚合、任务夹与归档成员集合）。
 * @param input.aggregates 全部主任务聚合（active + 软删除）。
 * @param input.folders 任务夹实体（id + parentId）。
 * @param input.archivedMemberIds 已归档成员集合；其分配在查询时失效（06 §4.1）。
 * @returns 派生索引。
 */
export function buildIndexes(input: {
  aggregates: TaskAggregate[];
  folders: Array<{ id: string; parentId: string | null }>;
  archivedMemberIds?: ReadonlySet<string>;
}): DerivedIndexes {
  const archived = input.archivedMemberIds ?? new Set<string>();
  const byId = new Map<string, TaskAggregate>();
  const folderChildren = new Map<string | null, string[]>();
  const activeTasksByFolder = new Map<string, string[]>();
  const historyTasksByFolder = new Map<string, string[]>();
  const assignmentsByMember = new Map<string, string[]>();
  const activeOwnersByTask = new Map<string, string[]>();

  for (const folder of input.folders) {
    pushIndex(folderChildren, folder.parentId, folder.id);
  }

  for (const aggregate of input.aggregates) {
    byId.set(aggregate.taskId, aggregate);
    pushIndex(historyTasksByFolder, aggregate.task.folderId, aggregate.taskId);
    if (aggregate.task.deletedAt === null) {
      pushIndex(activeTasksByFolder, aggregate.task.folderId, aggregate.taskId);
    }
    const owners = aggregate.assignments
      .filter((a) => a.taskId === aggregate.taskId && a.kind === "owner" && !archived.has(a.memberId))
      .map((a) => a.memberId);
    if (owners.length > 0) activeOwnersByTask.set(aggregate.taskId, owners);
    for (const assignment of aggregate.assignments) {
      if (archived.has(assignment.memberId)) continue;
      pushIndex(assignmentsByMember, assignment.memberId, assignment.taskId);
    }
  }

  return { byId, folderChildren, activeTasksByFolder, historyTasksByFolder, assignmentsByMember, activeOwnersByTask };
}
