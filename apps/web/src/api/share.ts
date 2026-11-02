import {
  API_PREFIX,
  type FolderTreeNode,
  type ShareHomeTasks,
  type ShareSessionResponse,
  type ShareTaskDetail,
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

  /** 只读事项跟踪：相关任务列表（可带任务夹/搜索/重要度/游标）。 */
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

  /** 任务详情（不相关任务 404；主任务/小任务两种形态）。 */
  task: (id: string) => requestJson<ShareTaskDetail>(`${API_PREFIX}/share/tasks/${id}`),

  /** 成员可见任务夹树（相关任务及祖先）。 */
  foldersTree: () => requestJson<{ tree: FolderTreeNode[] }>(`${API_PREFIX}/share/folders/tree`),
};
