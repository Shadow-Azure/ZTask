import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "@ztask/server";
import type { ServerConfig } from "@ztask/server";
import { makeFixtureStaticRoot, makeTempDataDir } from "./helpers.js";

async function appWith(overrides: Partial<ServerConfig>, listenerKind: "loopback" | "lan" = "loopback") {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    dataDir: await makeTempDataDir(),
    staticRoot: null,
    ...overrides,
  };
  const app = await buildApp(config, { listenerKind });
  return { app, config };
}

describe("GET /api/v1/health", () => {
  it("返回 200 与健康 payload", async () => {
    const { app } = await appWith({});
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    const body = response.json() as { status: string; version: string; uptimeSeconds: number };
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("未知 API 路由", () => {
  it("返回统一 404 JSON，绝不落 SPA fallback", async () => {
    const { app } = await appWith({ staticRoot: await makeFixtureStaticRoot() });
    for (const url of ["/api/v1/unknown", "/api/v1/admin/folders", "/api/legacy"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(404);
      expect(response.headers["content-type"], url).toContain("application/json");
      const body = response.json() as { error: { code: string; requestId: string } };
      expect(body.error.code, url).toBe("NOT_FOUND");
      expect(body.error.requestId, url).toBeTruthy();
    }
  });

  it("POST 等其他方法同样返回 404 JSON", async () => {
    const { app } = await appWith({});
    const response = await app.inject({ method: "POST", url: "/api/v1/tasks" });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain("NOT_FOUND");
  });
});

describe("静态资源同源托管", () => {
  it("根路径返回 index.html，深链走 SPA fallback", async () => {
    const { app } = await appWith({ staticRoot: await makeFixtureStaticRoot() });
    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.headers["content-type"]).toContain("text/html");
    expect(root.body).toContain("ztask-shell");

    const deep = await app.inject({ method: "GET", url: "/some/client/route" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("ztask-shell");
  });

  it("未配置静态目录时非 API 路径 404 文本，不抛异常", async () => {
    const { app } = await appWith({});
    const response = await app.inject({ method: "GET", url: "/" });
    expect(response.statusCode).toBe(404);
    expect(response.headers["content-type"]).not.toContain("text/html");
  });
});

describe("Admin 本机专用钩子（管理路由本体后续 issue）", () => {
  it("LAN listener 上的 /api/v1/admin/* 一律 403 ADMIN_LOCAL_ONLY", async () => {
    const { app } = await appWith({}, "lan");
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/folders" });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("ADMIN_LOCAL_ONLY");
  });

  it("loopback 上 admin 路由尚未实现，回落 404 JSON", async () => {
    const { app } = await appWith({});
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/folders" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });
});
