import { QueryClient } from "@tanstack/vue-query";
import { ApiError } from "@ztask/shared";

/**
 * 协作刷新轮询间隔：当前任务列表与成员域可见列表 15 秒轮询（03 §6）。
 */
export const POLL_INTERVAL_MS = 15_000;

function isClientError(error: unknown): boolean {
  if (error instanceof ApiError) return error.statusCode >= 400 && error.statusCode < 500;
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * 应用级 QueryClient（03 §6 请求与刷新策略）：
 * staleTime 15 秒 + 窗口聚焦失效刷新；4xx/ApiError 不重试，网络与 5xx 有限重试。
 * @returns 配置好的 QueryClient。
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: POLL_INTERVAL_MS,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (isClientError(error)) return false;
          return failureCount < 2;
        },
      },
    },
  });
}
