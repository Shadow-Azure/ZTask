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

/** 成员在相关任务中的角色（05 §6.5）；决定个人页写权限，只读跟踪忽略它。 */
export type ShareMemberRole = "owner" | "collaborator";

/** `/share/session` 的 200/201 响应：只含最小成员摘要，不含 token/verifier（05 §6.1–6.2）。 */
export interface ShareSessionResponse {
  member: MemberSummary;
}

/** `GET /share/tasks?view=home` 的响应（05 §6.4）：负责/协作两组已按 memberId 裁剪。 */
export interface ShareHomeTasks {
  owned: Task[];
  collaborated: Task[];
}

/** 成员写操作响应（05 §6.6–6.10）：更新后的成员可见任务与本次 revision。 */
export interface ShareTaskMutation {
  task: Task;
  revision: RevisionResult | null;
}

/** `GET /share/tasks?view=tracker` 的响应（05 §6.4）：分页游标为不透明字符串。 */
export interface ShareTrackerTasks {
  items: Task[];
  nextCursor: string | null;
}

/**
 * `GET /share/tasks/{id}` 的响应（05 §6.5）：主任务返回 Task 本体，
 * 小任务返回小任务与「只含当前成员可见小任务」的父任务。
 */
export type ShareTaskDetail =
  | (Task & { memberRole: ShareMemberRole })
  | { task: Subtask; parent: Task; memberRole: ShareMemberRole };

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

/** 历史变更类型（06 §7.1 受控枚举）：只有实际有效变更才追加 revision，读取与冲突不产生历史。 */
export type ChangeKind = "create" | "update" | "progress" | "detail" | "subtask" | "delete";

/**
 * revision 的最小公开形态（05 §2.1）：列表/看板只需要版本、时刻与变更语义；
 * 完整快照留在存储层，不进入 API。
 */
export interface RevisionResult {
  taskVersion: number;
  /** UTC RFC 3339。 */
  recordedAt: string;
  changeKind: ChangeKind;
}

/**
 * revision 的操作者。name 是操作时显示名快照，成员后续改名/归档不影响历史可读性；admin 操作 memberId 为 null。
 */
export interface RevisionActor {
  kind: "admin" | "member";
  memberId: string | null;
  name: string;
}

/**
 * 管理端成员行（05 §2.3）：含主任务计数与分享链接脱敏态；
 * raw token 与链接 URL 绝不进入该结构。
 */
export interface AdminMemberCounts {
  owned: number;
  collaborated: number;
}

/** 分享链接的脱敏态（05 §4.1/§4.8；不含 token/URL）。 */
export interface AdminMemberShareLink {
  status: "active" | "revoked";
  /** UTC RFC 3339。 */
  createdAt: string;
  /** UTC RFC 3339；未吊销为 null。 */
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** `GET /admin/members/{id}/share-link` 的响应（05 §4.8）：从未生成时 status=none。 */
export type AdminShareLinkState =
  | { status: "none" }
  | { status: "active" | "revoked"; createdAt: string; revokedAt: string | null; lastUsedAt: string | null };

/**
 * 生成/重置链接的响应（05 §4.5–4.6）：完整 url 只在此次响应出现，
 * 之后只能重新生成；不含 tokenHash。
 */
export interface AdminShareLinkIssued {
  id: string;
  status: "active";
  url: string;
  /** UTC RFC 3339。 */
  createdAt: string;
}

/** 可选网卡地址（05 §2.3 NetworkState.interfaces）：管理员必须明确选择。 */
export interface NetworkInterfaceInfo {
  name: string;
  address: string;
}

/** 分享监听状态（05 §2.3）：running/degraded 是运行时事实，enabled 是期望配置。 */
export interface ShareListenerState {
  enabled: boolean;
  running: boolean;
  degraded: boolean;
  host: string | null;
  port: number | null;
  shareBaseUrl: string | null;
  /** 脱敏错误（不含文件路径）；无错误为 null。 */
  error: string | null;
}

/** `GET /admin/network` 的响应（05 §2.3/§4.9）：仅本机管理员可见。 */
export interface NetworkState {
  loopbackUrl: string;
  interfaces: NetworkInterfaceInfo[];
  shareListener: ShareListenerState;
}

/** 管理端成员行（05 §2.3）：负责中/协作中为主任务口径的在册计数。 */
export interface AdminMember {
  id: string;
  name: string;
  role: string;
  color: string;
  /** UTC RFC 3339；null 表示在册。 */
  archivedAt: string | null;
  counts: AdminMemberCounts;
  /** m4 前恒为 null。 */
  shareLink: AdminMemberShareLink | null;
}
