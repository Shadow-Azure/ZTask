// @vitest-environment node
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createMember,
  createMemberAccessApp,
  exchangeCookie,
  seedShareLink,
  tmpDataDir,
} from "./support/share-fixtures.js";

/** 统一错误体（05 §7）：顶层只有 error，error 内是 code/message/requestId。 */
interface ErrorBody {
  error: { code: string; message: string; requestId: string };
  [key: string]: unknown;
}

let dataDir: string;
let app: FastifyInstance;
let cookie: string;

beforeEach(async () => {
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir);
  const member = await createMember(app, "陈晨");
  const { token } = await seedShareLink({ dataDir, memberId: member });
  cookie = await exchangeCookie(app, token);
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("统一错误体（05 §7；app.ts 处理器前置）", () => {
  it("管理端抛出的 ApiError 走统一嵌套体，不再回退 Fastify 默认体", async () => {
    // 空任务夹名由 folder-service 抛 ApiError(400 INVALID_REQUEST)，正好穿过 errorHandler。
    const response = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "  " } });
    expect(response.statusCode).toBe(400);
    const body = response.json() as ErrorBody;
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(body.error.requestId).toBeTruthy();
    // Fastify 默认体会把 statusCode/code/error 放在顶层，这里是回归红线。
    expect(body).not.toHaveProperty("statusCode");
    expect(body).not.toHaveProperty("code");
    expect(body.error).not.toHaveProperty("statusCode");
  });

  it("admin 400 / share 401 / share 404 的 shape 完全一致", async () => {
    const admin = await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "  " } });
    const unauthorized = await app.inject({ method: "GET", url: "/api/v1/share/tasks?view=home" });
    const notFound = await app.inject({
      method: "GET",
      url: `/api/v1/share/tasks/${randomUUID()}`,
      headers: { cookie },
    });

    expect(admin.statusCode).toBe(400);
    expect(unauthorized.statusCode).toBe(401);
    expect(notFound.statusCode).toBe(404);

    const bodies = [admin.json() as ErrorBody, unauthorized.json() as ErrorBody, notFound.json() as ErrorBody];
    expect(bodies.map((body) => body.error.code)).toEqual([
      "INVALID_REQUEST",
      "SHARE_SESSION_REQUIRED",
      "TASK_NOT_FOUND",
    ]);
    for (const body of bodies) {
      expect(Object.keys(body)).toEqual(["error"]);
      expect(Object.keys(body.error).sort()).toEqual(["code", "message", "requestId"]);
      expect(typeof body.error.message).toBe("string");
      expect(body.error.requestId).toBeTruthy();
    }
  });
});

describe("安全响应头（04 §8；§6.4）", () => {
  it("健康检查、share 成功响应、share 401 与未知 API 404 都带 no-referrer / nosniff", async () => {
    const responses = [
      await app.inject({ method: "GET", url: "/api/v1/health" }),
      await app.inject({ method: "GET", url: "/api/v1/share/tasks?view=tracker", headers: { cookie } }),
      await app.inject({ method: "GET", url: "/api/v1/share/tasks?view=home" }),
      await app.inject({ method: "GET", url: "/api/v1/unknown" }),
    ];
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 401, 404]);
    for (const response of responses) {
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    }
  });
});
