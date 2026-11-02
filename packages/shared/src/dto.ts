/** 成员在任务卡与分配选择器中的最小展示摘要；不含任何分享凭证字段。 */
export interface MemberSummary {
  id: string;
  name: string;
  role: string;
  color: string;
}

/**
 * 主任务下的一层小任务；不允许再嵌套（三层即 422）。
 * version 是所属主任务聚合的并发版本，小任务变化同样递增它。
 */
export interface Subtask {
  id: string;
  parentId: string;
  description: string;
  owner: MemberSummary;
  /** 0–100 整数。 */
  progress: number;
  importance: Importance;
  /** YYYY-MM-DD 或 null 表示未设置。 */
  dueDate: string | null;
  version: number;
}

/**
 * 主任务聚合的读侧 DTO。version 是聚合并发版本：
 * 编辑请求必须携带它，服务端在写队列内复查，冲突返回 409 与最新实体。
 */
export interface Task {
  id: string;
  folderId: string;
  /** 首版只有"主任务 → 小任务"两层；主任务的 parentId 恒为 null。 */
  parentId: null;
  description: string;
  owners: MemberSummary[];
  collaborators: MemberSummary[];
  /** 0–100 整数。 */
  progress: number;
  detail: string;
  importance: Importance;
  /** YYYY-MM-DD 或 null 表示未设置。 */
  dueDate: string | null;
  version: number;
  /** UTC RFC 3339。 */
  createdAt: string;
  /** UTC RFC 3339。 */
  updatedAt: string;
  subtasks: Subtask[];
}

/** 任务夹；层级是 JSON 字段而非物理目录，可嵌套，首版不开放移动/删除。 */
export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
}

/** 任务夹树节点；tasks 只带卡片所需的轻量字段，counts 由可见任务计算。 */
export interface FolderTreeNode extends Folder {
  children: FolderTreeNode[];
  tasks: Array<{ id: string; description: string; progress: number; importance: Importance }>;
  counts: { done: number; todo: number };
}

/** GET /api/v1/health 的响应体。健康检查匿名可用，不泄露文件系统路径。 */
export interface HealthPayload {
  /** 恒为 "ok"；不可达时客户端收到的是连接错误而非降级 payload。 */
  status: "ok";
  /** 服务进程的语义化版本。 */
  version: string;
  /** 进程已运行秒数，向下取整。 */
  uptimeSeconds: number;
}

/** 任务与成员档案的重要性档位。 */
export type Importance = "high" | "mid" | "low";
