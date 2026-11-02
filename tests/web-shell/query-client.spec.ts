// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ApiError } from "@ztask/shared";
import { POLL_INTERVAL_MS, createAppQueryClient } from "../../apps/web/src/api/queryClient";

describe("createAppQueryClient", () => {
  it("staleTime 15 秒、窗口聚焦刷新开启、轮询间隔 15 秒", () => {
    const client = createAppQueryClient();
    expect(client.getDefaultOptions().queries?.staleTime).toBe(15_000);
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(true);
    expect(POLL_INTERVAL_MS).toBe(15_000);
  });

  it("4xx / ApiError 不自动重试", () => {
    const client = createAppQueryClient();
    const retry = client.getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: unknown,
    ) => boolean;
    expect(retry(0, new ApiError(404, "NOT_FOUND", "x"))).toBe(false);
    expect(retry(0, Object.assign(new Error("x"), { statusCode: 400 }))).toBe(false);
  });

  it("网络/5xx 有限重试（最多 2 次）", () => {
    const client = createAppQueryClient();
    const retry = client.getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: unknown,
    ) => boolean;
    expect(retry(0, new Error("network"))).toBe(true);
    expect(retry(1, Object.assign(new Error("x"), { statusCode: 502 }))).toBe(true);
    expect(retry(2, new Error("network"))).toBe(false);
  });
});
