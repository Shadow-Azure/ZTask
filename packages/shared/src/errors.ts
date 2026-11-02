/**
 * 统一错误码与错误模型（契约见 plan/fullstack-design/05 §7）。
 * 错误响应形状固定为 `{ error: { code, message, requestId, details? } }`；
 * 业务路由按需引用这里的码，禁止在路由里私造字符串。
 */

export const API_ERROR_CODES = [
  // 400
  "INVALID_REQUEST",
  // 401
  "SHARE_SESSION_REQUIRED",
  // 403
  "ADMIN_LOCAL_ONLY",
  "OWNER_REQUIRED",
  "TASK_READ_ONLY",
  // 404
  "NOT_FOUND",
  "TASK_NOT_FOUND",
  "SHARE_LINK_INVALID",
  // 409
  "TASK_VERSION_CONFLICT",
  "ACTIVE_SHARE_LINK_EXISTS",
  "LAN_SHARE_DISABLED",
  // 422
  "TASK_DEPTH_EXCEEDED",
  "ASSIGNMENT_ROLE_CONFLICT",
  "LAN_INTERFACE_INVALID",
  // 429
  "SHARE_EXCHANGE_RATE_LIMITED",
  // 500
  "INTERNAL_ERROR",
] as const;

/** 错误码封闭集合；新增码先改这里并同步 05 §7 文档表，禁止路由私造字符串。 */
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/** 统一错误响应体。requestId 由服务端为每个请求生成并回显。 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

/** 服务端领域错误：路由与 service 抛出，HTTP 层统一序列化为 ApiErrorBody。 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
