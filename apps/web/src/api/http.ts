import { ApiError, API_ERROR_CODES, type ApiErrorCode } from "@ztask/shared";

export { ApiError, type ApiErrorCode };

/** requestJson 的选项；timeoutMs 默认 15 秒，与协作轮询同量级。 */
export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** 查询参数（undefined/null 值会被跳过）。 */
  query?: Record<string, string | number | boolean | undefined | null>;
  timeoutMs?: number;
}

function isApiErrorCode(value: string): value is ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(value);
}

function errorFromStatus(status: number): ApiErrorCode {
  if (status === 400) return "INVALID_REQUEST";
  if (status === 401) return "SHARE_SESSION_REQUIRED";
  if (status === 403) return "ADMIN_LOCAL_ONLY";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "SHARE_EXCHANGE_RATE_LIMITED";
  if (status >= 500) return "INTERNAL_ERROR";
  return "INVALID_REQUEST";
}

/**
 * 同源 JSON 请求封装（03 §3 api/http）：相对路径、凭证同源、统一错误模型、超时取消。
 * 绝不把请求体、token 或错误正文写入日志——错误只携带结构化字段。
 * @param path API 路径（以 / 开头的同源相对路径，通常来自 API_PREFIX 拼接）。
 * @param options method/body/query/timeout。
 * @returns 解析后的 JSON（204 为 undefined）。
 * @throws ApiError 后端统一错误体、非 JSON 错误响应与网络/超时（code=NETWORK_ERROR）。
 */
export async function requestJson<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR" as ApiErrorCode, "网络错误或请求超时");
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const body = (parsed as {
      error?: { code?: string; message?: string; requestId?: string; details?: unknown };
    } | null)?.error;
    if (body && typeof body.code === "string" && isApiErrorCode(body.code)) {
      // details 是 05 §7 契约的一部分（如 409 的 details.current），不能丢；
      // 其余错误没有 details 时保持 { requestId }，与既有断言兼容。
      const details = body.details !== null && typeof body.details === "object" ? body.details : {};
      throw new ApiError(response.status, body.code, body.message ?? response.statusText, {
        requestId: body.requestId,
        ...details,
      });
    }
    throw new ApiError(response.status, errorFromStatus(response.status), response.statusText || "请求失败");
  }

  if (response.status === 304) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, "INTERNAL_ERROR", "响应不是合法 JSON");
  }
}
