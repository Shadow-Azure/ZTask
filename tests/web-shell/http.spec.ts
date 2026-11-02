// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ApiError, requestJson } from "../../apps/web/src/api/http";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("requestJson", () => {
  it("同源相对路径请求并解析 JSON", async () => {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return jsonResponse(200, { ok: true });
    }) as typeof fetch;
    try {
      await expect(requestJson("/api/v1/health")).resolves.toEqual({ ok: true });
      expect(new URL(calls[0]!).pathname).toBe("/api/v1/health");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("后端统一错误体映射为 ApiError（保留 code/message/requestId）", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      jsonResponse(409, {
        error: { code: "TASK_VERSION_CONFLICT", message: "任务已被其他人更新", requestId: "r-1" },
      })) as typeof fetch;
    try {
      const cause = await requestJson("/api/v1/tasks").catch((e: unknown) => e);
      expect(cause).toBeInstanceOf(ApiError);
      expect((cause as ApiError).statusCode).toBe(409);
      expect((cause as ApiError).code).toBe("TASK_VERSION_CONFLICT");
      expect((cause as ApiError).details).toEqual({ requestId: "r-1" });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("非 JSON 错误响应按状态码构造 ApiError", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("gateway timeout", { status: 504 })) as typeof fetch;
    try {
      await expect(requestJson("/api/v1/x")).rejects.toBeInstanceOf(ApiError);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("超时触发 AbortController 并抛 ApiError（网络类）", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }) as typeof fetch;
    try {
      await expect(requestJson("/api/v1/slow", { timeoutMs: 20 })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("204 返回 undefined", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
    try {
      await expect(requestJson("/api/v1/x", { method: "DELETE" })).resolves.toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
