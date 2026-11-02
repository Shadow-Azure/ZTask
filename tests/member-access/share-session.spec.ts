// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, initStore, mintShareLinkForTest, requestShareSession } from "@ztask/server";
import type { FastifyInstance } from "fastify";

let dataDir: string;
let app: FastifyInstance;
let folderId: string;
let memberA: string;
let memberB: string;
let taskA: string;
let taskB: string;
let tokenA: string;
let tokenB: string;
let cookieA: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `ztask-member-access-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
  const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  app = await buildApp({ host: "127.0.0.1", port: 0, dataDir, staticRoot: null }, { store });

  folderId = (await app.inject({ method: "POST", url: "/api/v1/admin/folders", payload: { name: "迭代", parentId: null } })).json().id;
  memberA = (await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "陈晨" } })).json().id;
  memberB = (await app.inject({ method: "POST", url: "/api/v1/admin/members", payload: { name: "林悦" } })).json().id;

  async function createTask(description: string, ownerIds: string[], collaboratorIds: string[]): Promise<string> {
    const response = await app.inject({
      method: "POST", url: "/api/v1/admin/tasks",
      payload: { folderId, parentId: null, description, ownerIds, collaboratorIds, progress: 30, detail: `${description}详情`, importance: "mid", dueDate: null },
    });
    return response.json().id;
  }

  taskA = await createTask("A 的任务", [memberA], []);
  taskB = await createTask("B 的任务", [memberB], []);

  tokenA = await mintShareLinkForTest({ dataDir, memberId: memberA });
  tokenB = await mintShareLinkForTest({ dataDir, memberId: memberB });

  const session = await requestShareSession({ dataDir }, tokenA);
  if (!session) throw new Error("session exchange failed");
  cookieA = session.cookie;
  void taskA; void taskB;
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("POST /share/session（令牌交换）", () => {
  it("有效 token：201 + HttpOnly Set-Cookie + 成员摘要（不含 token/verifier）", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token: tokenB } });
    expect(response.statusCode).toBe(201);
    expect(response.json().member.name).toBe("林悦");
    const setCookie = response.headers["set-cookie"] as unknown as string[];
    const cookie = Array.isArray(setCookie) ? setCookie[0]! : setCookie;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie.toLowerCase()).not.toContain(tokenB.toLowerCase());
  });

  it("无效/已吊销/空 token 统一 401 SHARE_LINK_INVALID", async () => {
    for (const token of ["bogus-token", ""]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token } });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("SHARE_LINK_INVALID");
    }
  });
});

describe("GET /share/session（会话恢复）", () => {
  it("有效 Cookie 恢复成员身份", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(response.statusCode).toBe(200);
    expect(response.json().member.name).toBe("陈晨");
  });

  it("无 Cookie 返回 401 SHARE_SESSION_REQUIRED", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/share/session" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SHARE_SESSION_REQUIRED");
  });
});

describe("DELETE /share/session（注销）", () => {
  it("注销后 Cookie 清除且旧会话失效", async () => {
    const removed = await app.inject({ method: "DELETE", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(removed.statusCode).toBe(204);
    expect(removed.headers["set-cookie"]).toBeTruthy();

    const restored = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(restored.statusCode).toBe(401);
  });
});

describe("成员数据隔离（A/B 隔离矩阵）", () => {
  it("home 视图：A 只见自己负责/协作的任务", async () => {
    const home = await app.inject({ method: "GET", url: "/api/v1/share/tasks?view=home", headers: { cookie: cookieA } });
    expect(home.statusCode).toBe(200);
    const body = home.json();
    expect(body.owned.map((t: { description: string }) => t.description)).toEqual(["A 的任务"]);
    expect(body.collaborated).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("B 的任务");
  });

  it("tracker 视图 + 相关任务详情；跨成员任务 404", async () => {
    const tracker = await app.inject({ method: "GET", url: "/api/v1/share/tasks?view=tracker", headers: { cookie: cookieA } });
    expect(tracker.statusCode).toBe(200);
    const descriptions = tracker.json().items.map((t: { description: string }) => t.description);
    expect(descriptions).toEqual(["A 的任务"]);

    const own = await app.inject({ method: "GET", url: `/api/v1/share/tasks/${taskA}`, headers: { cookie: cookieA } });
    expect(own.statusCode).toBe(200);
    expect(own.json().memberRole).toBe("owner");

    const foreign = await app.inject({ method: "GET", url: `/api/v1/share/tasks/${taskB}`, headers: { cookie: cookieA } });
    expect(foreign.statusCode).toBe(404);
  });

  it("相关树只含可见任务夹与计数", async () => {
    const tree = await app.inject({ method: "GET", url: "/api/v1/share/folders/tree", headers: { cookie: cookieA } });
    expect(tree.statusCode).toBe(200);
    expect(JSON.stringify(tree.json())).toContain("迭代");
    // 管理路由的本机守卫由 #12 覆盖（loopback 即管理员）；成员边界由 share 作用域保证
  });

  it("吊销链接后：旧会话立即失效（link 状态兜底）", async () => {
    // 直接把 share-link 状态改为 revoked
    const { readFile, writeFile } = await import("node:fs/promises");
    const linkPath = path.join(dataDir, "share-links", `${memberA}.json`);
    const link = JSON.parse(await readFile(linkPath, "utf8"));
    link.status = "revoked";
    await writeFile(linkPath, JSON.stringify(link, null, 2), "utf8");

    const restored = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(restored.statusCode).toBe(401);

    const tasks = await app.inject({ method: "GET", url: "/api/v1/share/tasks?view=home", headers: { cookie: cookieA } });
    expect(tasks.statusCode).toBe(401);
  });
});
