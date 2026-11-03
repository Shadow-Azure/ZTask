import type { FastifyError } from "fastify";
import { StorageError } from "../storage/errors.js";

/** 用户可见的错误摘要：message 直接展示，cause 仅用于服务端日志与测试断言。 */
export interface ErrorDescription {
  /** 面向用户的中文说明，含原因分类、下一步动作与请求编号。 */
  message: string;
  /** 内部原因分类（错误码或 Node 错误码），不直接展示给用户。 */
  cause: string;
}

/** 常见校验字段的中文名；未知字段回退为原字段名。 */
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

/** Node 文件系统错误码到用户动作的映射（只列保存链路常见故障）。 */
const FS_ERROR_HINTS: Readonly<Record<string, string>> = {
  EACCES: "数据目录不可写，请检查 ZTask 数据目录的权限后重试",
  EPERM: "数据目录不可写，请检查 ZTask 数据目录的权限后重试",
  EROFS: "数据目录位于只读文件系统，请改用可写的数据目录",
  ENOSPC: "磁盘空间不足，请清理空间后重试",
  EDQUOT: "磁盘配额不足，请清理空间后重试",
  ENOENT: "数据目录或目标文件不存在，请确认数据目录未被移动后重试",
  EMFILE: "服务端打开文件过多，请稍后重试；若持续出现请重启 ZTask",
};

/**
 * 把异常归类为固定的错误码文本。
 * @param error 任意抛出值。
 * @returns StorageError.code、Node 错误码或 unknown。
 */
function causeCode(error: unknown): string {
  if (error instanceof StorageError) return error.code;
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && code !== "" ? code : "UNKNOWN";
}

/**
 * 从 AJV/Fastify 校验错误中提取字段名（如 progress）。
 * @param error Fastify 校验错误。
 * @returns 字段名；无法提取时为 null。
 */
function validationField(error: FastifyError): string | null {
  const fromPath = (error.validation?.[0]?.instancePath ?? "").split("/").filter(Boolean).pop();
  if (fromPath) return fromPath;
  const fromMessage = /^(?:body|query|params)\/([A-Za-z0-9_]+)/.exec(error.message ?? "");
  return fromMessage?.[1] ?? null;
}

/**
 * 把服务端内部异常翻译成安全、可操作的用户提示。
 *
 * 绝不拼接原始异常消息：存储层消息常带数据目录绝对路径。用户只看到
 * 错误分类、下一步动作与请求编号；堆栈由调用方写入日志。
 * @param error 任意未预期异常。
 * @param requestId 当前请求编号。
 * @param mutating 是否为写请求（决定“保存失败”或“读取失败”措辞）。
 * @returns 用户提示与内部原因分类。
 */
export function describeInternalError(error: unknown, requestId: string, mutating = true): ErrorDescription {
  const action = mutating ? "保存失败" : "读取失败";
  const cause = causeCode(error);
  if (error instanceof StorageError) {
    let reason: string;
    switch (error.code) {
      case "STORAGE_CORRUPTION":
        reason = "数据文件校验不通过，可能已损坏。请先从备份恢复再重试";
        break;
      case "STORAGE_ENTRY_NOT_FOUND":
        reason = "目标任务数据已不存在，可能被删除或恢复过。请刷新页面后重试";
        break;
      case "STORAGE_UNSUPPORTED_FORMAT":
        reason = "数据格式版本高于当前应用。请升级 ZTask 后重试";
        break;
      default:
        reason = "数据写入异常。请检查数据目录权限和磁盘空间后重试";
    }
    return { message: `${action}：${reason}（原因：${error.code}，请求编号：${requestId}）`, cause };
  }
  const fsHint = FS_ERROR_HINTS[cause];
  if (fsHint !== undefined) {
    return { message: `${action}：${fsHint}（原因：${cause}，请求编号：${requestId}）`, cause };
  }
  return {
    message: `${action}：服务端处理异常。请重试；若持续出现，请把请求编号和操作步骤提供给维护者（请求编号：${requestId}）。`,
    cause,
  };
}

/**
 * 把 AJV/Fastify 校验错误翻译成中文动作提示。
 *
 * Fastify 默认消息形如 `body/progress must be integer`，直接展示会让用户
 * 无法判断改哪个字段；这里保留原始技术细节作为兜底，常见字段与关键字
 * 则给出中文说明。
 * @param error Fastify 校验错误。
 * @returns 面向用户的中文说明。
 */
export function describeValidationError(error: FastifyError): string {
  const message = error.message ?? "请求数据不合法";
  const field = validationField(error);
  const label = field === null ? "字段" : `「${FIELD_LABELS[field] ?? field}」`;
  if (/must be integer/.test(message)) {
    return field === "progress"
      ? "小任务进度必须是 0–100 的整数。"
      : `${label}必须是整数。`;
  }
  if (/must be string/.test(message)) return `${label}必须是文本。`;
  if (/must be equal to one of the allowed values/.test(message)) return `${label}取值不合法。`;
  if (/must NOT have additional properties/.test(message)) {
    return "提交的数据包含不支持的字段，请刷新页面后重试。";
  }
  const required = /must have required property '([^']+)'/.exec(message)?.[1];
  if (required !== undefined) return `缺少必填字段「${FIELD_LABELS[required] ?? required}」。`;
  if (/must be array/.test(message)) return `${label}必须是列表。`;
  return `请求数据不合法（${message}），请检查填写内容后重试。`;
}
