import {
  API_PREFIX,
  type FolderTreeNode,
  type ShareHomeTasks,
  type ShareSessionResponse,
  type ShareTaskDetail,
  type DashboardChanges,
  type DashboardDueDistribution,
  type DashboardSummary,
  type DashboardTasks,
  type ShareTaskMutation,
  type ShareTrackerTasks,
} from "@ztask/shared";
import { requestJson } from "./http";

/** `GET /share/tasks?view=tracker` 的查询参数（05 §6.4）。 */
export interface ShareTrackerParams {
  folderId?: string;
  q?: string;
  importance?: string;
  cursor?: string;
}

/**
 * 成员分享域资源函数（05 §6）：凭证由 HttpOnly Cookie 承载，全部同源请求；
 * token 只作为 `exchange` 的参数短暂存在，绝不写入缓存或持久存储。
 */
export const shareApi = {
  /** fragment token 换会话（成功后调用方须立即 replace 清除 fragment）。 */
  exchange: (token: string) =>
    requestJson<ShareSessionResponse>(`${API_PREFIX}/share/session`, { method: "POST", body: { token } }),

  /** Cookie 恢复会话；401 表示无有效会话。 */
  restore: () => requestJson<ShareSessionResponse>(`${API_PREFIX}/share/session`),

  /** 注销：清除会话文件与 Cookie（204）。 */
  logout: () => requestJson<void>(`${API_PREFIX}/share/session`, { method: "DELETE" }),

  /** 个人页：我负责的/我协作的两组只读任务。 */
  home: () => requestJson<ShareHomeTasks>(`${API_PREFIX}/share/tasks`, { query: { view: "home" } }),

  /** 只读事项跟踪：团队全部任务列表（可带任务夹/搜索/重要度/游标）。 */
  tracker: (params: ShareTrackerParams = {}) =>
    requestJson<ShareTrackerTasks>(`${API_PREFIX}/share/tasks`, {
      query: {
        view: "tracker",
        folderId: params.folderId,
        q: params.q,
        importance: params.importance,
        cursor: params.cursor,
      },
    }),

  /** 任务详情（不存在/软删除 404；主任务/小任务两种形态）。 */
  task: (id: string) => requestJson<ShareTaskDetail>(`${API_PREFIX}/share/tasks/${id}`),

  /** 成员任务夹树（完整团队树，含空夹）。 */
  foldersTree: () => requestJson<{ tree: FolderTreeNode[] }>(`${API_PREFIX}/share/folders/tree`),

  /** 负责人保存主任务进度（05 §6.6）：progress 0–100 + 聚合 version。 */
  saveProgress: (taskId: string, body: { progress: number; version: number }) =>
    requestJson<ShareTaskMutation>(`${API_PREFIX}/share/tasks/${taskId}/progress`, { method: "PATCH", body }),

  /** 负责人保存完整进展详情（05 §6.7）：替换当前文本并追加快照。 */
  saveDetail: (taskId: string, body: { detail: string; version: number }) =>
    requestJson<ShareTaskMutation>(`${API_PREFIX}/share/tasks/${taskId}/detail`, { method: "PATCH", body }),

  /** 负责人在自己主任务下新建一层小任务（05 §6.8）；owner 恒为当前成员。 */
  createSubtask: (
    taskId: string,
    body: { version: number; description: string; progress?: number; importance?: string; dueDate?: string | null },
  ) =>
    requestJson<ShareTaskMutation>(`${API_PREFIX}/share/tasks/${taskId}/subtasks`, { method: "POST", body }),

  /** 负责人编辑自己主任务下的小任务（05 §6.9）；不能改 owner。 */
  updateSubtask: (
    taskId: string,
    subtaskId: string,
    body: { version: number; description?: string; progress?: number; importance?: string; dueDate?: string | null },
  ) =>
    requestJson<ShareTaskMutation>(`${API_PREFIX}/share/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: "PATCH",
      body,
    }),

  /** 成员看板三统计卡（05 §6.12）：统计团队全部任务，可按 owner 传 memberIds。 */
  dashboardSummary: (params: { folderId: string; memberIds?: string[] }) =>
    requestJson<DashboardSummary>(`${API_PREFIX}/share/dashboard/summary`, {
      query: {
        folderId: params.folderId,
        memberIds: params.memberIds?.length ? params.memberIds.join(",") : undefined,
      },
    }),

  /** 成员时间段历史变化（05 §6.14）：看团队全部任务的历史。 */
  dashboardChanges: (params: {
    folderId: string;
    memberIds?: string[];
    mode: "default" | "custom";
    startDate?: string;
    endDate?: string;
  }) =>
    requestJson<DashboardChanges>(`${API_PREFIX}/share/dashboard/changes`, {
      query: {
        folderId: params.folderId,
        memberIds: params.memberIds?.length ? params.memberIds.join(",") : undefined,
        mode: params.mode,
        startDate: params.startDate,
        endDate: params.endDate,
      },
    }),

  /** 成员看板预计完成分布（05 §6.13）。 */
  dashboardDueDistribution: (params: { folderId: string; bucket: string; memberIds?: string[] }) =>
    requestJson<DashboardDueDistribution>(`${API_PREFIX}/share/dashboard/due-distribution`, {
      query: {
        folderId: params.folderId,
        bucket: params.bucket,
        memberIds: params.memberIds?.length ? params.memberIds.join(",") : undefined,
      },
    }),

  /** 成员看板任务明细（分页）：只返回当前成员相关任务。 */
  dashboardTasks: (params: { folderId: string; bucket: string; memberIds?: string[]; cursor?: string }) =>
    requestJson<DashboardTasks>(`${API_PREFIX}/share/dashboard/tasks`, {
      query: {
        folderId: params.folderId,
        bucket: params.bucket,
        memberIds: params.memberIds?.length ? params.memberIds.join(",") : undefined,
        cursor: params.cursor,
      },
    }),

  /** 负责人删除自己主任务下的小任务（05 §6.10），软删除并递增父聚合 version。 */
  deleteSubtask: (taskId: string, subtaskId: string, version: number) =>
    requestJson<ShareTaskMutation>(`${API_PREFIX}/share/tasks/${taskId}/subtasks/${subtaskId}`, {
      method: "DELETE",
      query: { version },
    }),
};
