import { API_PREFIX, type AdminMember, type Folder, type FolderTreeNode, type Subtask, type Task } from "@ztask/shared";
import { requestJson } from "./http";

/** 管理端资源函数（03 §3 api/admin）：全部走同源 /api/v1/admin。 */
export const adminApi = {
  /** 任务夹树（含任务摘要与计数）。 */
  folderTree: () => requestJson<{ tree: FolderTreeNode[] }>(`${API_PREFIX}/admin/folders/tree`),

  /** 创建根夹或子夹。 */
  createFolder: (input: { name: string; parentId: string | null }) =>
    requestJson<Folder>(`${API_PREFIX}/admin/folders`, { method: "POST", body: input }),

  /** 重命名任务夹。 */
  renameFolder: (id: string, name: string) =>
    requestJson<Folder>(`${API_PREFIX}/admin/folders/${id}`, { method: "PATCH", body: { name } }),

  /** 成员列表（含计数与脱敏链接态）。 */
  members: () => requestJson<{ items: AdminMember[] }>(`${API_PREFIX}/admin/members`),

  /** 添加成员。 */
  createMember: (input: { name: string; role?: string; color?: string }) =>
    requestJson<AdminMember>(`${API_PREFIX}/admin/members`, { method: "POST", body: input }),

  /** 更新成员姓名/角色/颜色。 */
  updateMember: (id: string, patch: { name?: string; role?: string; color?: string }) =>
    requestJson<AdminMember>(`${API_PREFIX}/admin/members/${id}`, { method: "PATCH", body: patch }),

  /** 归档成员（DELETE 语义：历史任务保留并显示待分配）。 */
  archiveMember: (id: string) =>
    requestJson<void>(`${API_PREFIX}/admin/members/${id}`, { method: "DELETE" }),
};

/** 任务列表查询参数（05 §3.4）。 */
export interface TaskListParams {
  folderId: string;
  includeDescendants?: boolean;
  q?: string;
  importance?: string;
  cursor?: string;
}

/** 任务详情响应（小任务时为 { task, parent }）。 */
export type TaskDetail = Task | { task: Subtask; parent: Task };

function isSubtaskDetail(value: TaskDetail): value is { task: Subtask; parent: Task } {
  return typeof value === "object" && value !== null && "task" in value && "parent" in value;
}

/** 管理端任务资源函数（05 §3.4–3.9）；409 由调用方保留草稿处理。 */
export const adminTaskApi = {
  list: (params: TaskListParams) => {
    const query: Record<string, string | number | boolean | undefined> = {
      folderId: params.folderId,
      includeDescendants: params.includeDescendants,
      q: params.q,
      importance: params.importance,
      cursor: params.cursor,
    };
    return requestJson<{ items: Task[]; nextCursor: string | null }>(`${API_PREFIX}/admin/tasks`, { query });
  },

  get: (id: string) => requestJson<TaskDetail>(`${API_PREFIX}/admin/tasks/${id}`),

  create: (body: Record<string, unknown>) =>
    requestJson<TaskDetail>(`${API_PREFIX}/admin/tasks`, { method: "POST", body }),

  patch: (id: string, body: Record<string, unknown>) =>
    requestJson<TaskDetail>(`${API_PREFIX}/admin/tasks/${id}`, { method: "PATCH", body }),

  saveEditor: (id: string, body: Record<string, unknown>) =>
    requestJson<Task>(`${API_PREFIX}/admin/tasks/${id}/editor`, { method: "PUT", body }),

  remove: (id: string, version: number) =>
    requestJson<void>(`${API_PREFIX}/admin/tasks/${id}?version=${version}`, { method: "DELETE" }),

  /** 小任务响应判定工具。 */
  isSubtaskDetail,
};

