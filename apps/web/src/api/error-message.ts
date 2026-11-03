import { ApiError } from "@ztask/shared";

/** 常见字段的中文名；未知字段回退为原字段名。 */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  progress: "进度",
  description: "描述",
  version: "版本",
  dueDate: "预计完成时间",
  importance: "重要度",
  ownerId: "负责人",
  ownerIds: "负责人",
  collaboratorIds: "协作人员",
  folderId: "任务夹",
  parentId: "父任务",
  subtasks: "小任务",
};

/**
 * 从 Fastify/AJV 错误消息中提取字段名，例如 `body/progress must be integer` → progress。
 * @param message 服务端原始消息。
 * @returns 字段名；无法提取时为 null。
 */
function fieldOf(message: string): string | null {
  const match = /^(?:body|query|params)\/([A-Za-z0-9_]+)/.exec(message);
  return match?.[1] ?? null;
}

/**
 * 把服务端英文校验消息翻译成用户能直接照做的中文提示。
 * 已是中文的领域消息原样返回，避免二次包装。
 * @param message 服务端错误消息。
 * @returns 中文提示。
 */
export function translateServerValidation(message: string): string {
  if (/[\u4e00-\u9fff]/.test(message)) return message;
  const field = fieldOf(message);
  const label = field === null ? "字段" : `「${FIELD_LABELS[field] ?? field}」`;
  if (/must be integer/.test(message)) {
    return field === "progress" ? "小任务进度必须是 0–100 的整数。" : `${label}必须是整数。`;
  }
  if (/must be string/.test(message)) return `${label}必须是文本。`;
  if (/must be equal to one of the allowed values/.test(message)) return `${label}取值不合法。`;
  if (/must be array/.test(message)) return `${label}必须是列表。`;
  if (/must NOT have additional properties/.test(message)) {
    return "提交的数据包含不支持的字段，请刷新页面后重试。";
  }
  const required = /must have required property '([^']+)'/.exec(message)?.[1];
  if (required !== undefined) return `缺少必填字段「${FIELD_LABELS[required] ?? required}」。`;
  return "提交的数据不合法，请检查填写内容后重试。";
}

/**
 * 读取 ApiError 携带的请求编号（response body 的 requestId 存在 details 里）。
 * @param error API 错误。
 * @returns 请求编号；不存在时为 undefined。
 */
function requestIdOf(error: ApiError): string | undefined {
  const id = (error.details as { requestId?: unknown } | undefined)?.requestId;
  return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * 在提示后补请求编号；已包含编号时不重复。
 * @param message 用户提示。
 * @param requestId 请求编号。
 * @returns 带编号的提示。
 */
function withRequestId(message: string, requestId: string | undefined): string {
  if (requestId === undefined || message.includes("请求编号")) return message;
  return `${message}（请求编号：${requestId}）`;
}

/**
 * 统一的用户可见错误说明：把错误码与英文校验消息变成中文动作提示。
 *
 * 服务端已经给出中文原因（如存储损坏、目录不可写）时原样展示；只有
 * 500 的旧兜底文案或未知英文消息才替换，避免把内部细节直接抛给用户。
 * @param cause 任意抛出值（通常是 ApiError 或 Error）。
 * @param fallback 非 Error 抛出值时的兜底文案。
 * @returns 可直接展示的中文提示。
 */
export function describeApiError(cause: unknown, fallback = "操作失败，请重试"): string {
  if (!(cause instanceof Error)) return fallback;
  if (!(cause instanceof ApiError)) return cause.message.trim() === "" ? fallback : cause.message;
  const requestId = requestIdOf(cause);
  switch (cause.code) {
    case "NETWORK_ERROR":
      return "网络错误或请求超时。请确认 ZTask 服务仍在运行后重试。";
    case "TASK_VERSION_CONFLICT":
      return "任务已被其他人更新。你的草稿已保留，请刷新后重试。";
    case "NOT_FOUND":
    case "TASK_NOT_FOUND":
      return "任务不存在或已被删除，请刷新后重试。";
    case "OWNER_REQUIRED":
      return "只有任务负责人可以修改该项。";
    case "ADMIN_LOCAL_ONLY":
      return "管理接口仅允许在服务主机本机访问。";
    case "SHARE_SESSION_REQUIRED":
    case "SHARE_LINK_INVALID":
      return "分享会话已失效，请让管理员重新生成分享链接。";
    case "INVALID_REQUEST": {
      const translated = translateServerValidation(cause.message);
      return translated;
    }
    case "INTERNAL_ERROR": {
      const message = cause.message.trim();
      const legacy = message === "" || message === "内部错误" || !/[\u4e00-\u9fff]/.test(message);
      return withRequestId(
        legacy
          ? "服务端处理失败。请重试；若持续出现，请把操作步骤提供给维护者。"
          : message,
        requestId,
      );
    }
    default:
      return withRequestId(cause.message.trim() === "" ? fallback : cause.message, requestId);
  }
}
