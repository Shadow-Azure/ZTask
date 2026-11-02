import { API_PREFIX, type AdminMember, type Folder, type FolderTreeNode } from "@ztask/shared";
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
