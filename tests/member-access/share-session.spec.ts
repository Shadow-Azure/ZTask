// @vitest-environment node
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createMember,
  createMemberAccessApp,
  exchangeCookie,
  readSessionFile,
  readShareLink,
  seedShareLink,
  updateShareLink,
  sessionIdOf,
  sha256,
  tmpDataDir,
  updateSessionFile,
} from "./support/share-fixtures.js";

let dataDir: string;
let app: FastifyInstance;
let memberA: string;
let memberB: string;
let tokenA: string;
let tokenB: string;

beforeEach(async () => {
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir);
  memberA = await createMember(app, "陈晨");
  memberB = await createMember(app, "林悦");
  ({ token: tokenA } = await seedShareLink({ dataDir, memberId: memberA }));
  ({ token: tokenB } = await seedShareLink({ dataDir, memberId: memberB }));
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

function setCookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  return String(value ?? "");
}

describe("POST /share/session（令牌交换）", () => {
  it("有效 token：201 + HttpOnly Set-Cookie + 成员摘要（不含 token/verifier/tokenHash）", async () => {
    const response = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token: tokenB } });
    expect(response.statusCode).toBe(201);
    expect(response.json().member.name).toBe("林悦");

    const cookie = setCookieOf(response);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/v1/share");

    // 05 §6.1：响应不返回 raw token、verifier 或 tokenHash。
    expect(response.body).not.toContain(tokenB);
    expect(response.body).not.toContain(sha256(tokenB));
    expect(response.body).not.toContain("verifier");
    expect(response.body).not.toContain("tokenHash");
  });

  it("无效/空 token 统一 401 SHARE_LINK_INVALID", async () => {
    for (const token of ["bogus-token-0123456789", ""]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token } });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("SHARE_LINK_INVALID");
    }
  });

  it("固定窗口限流：第 11 次 429 + Retry-After；GET/DELETE 与不同 IP 不受影响", async () => {
    const cookieA = await exchangeCookie(app, tokenA); // 第 1 次
    for (let attempt = 0; attempt < 9; attempt += 1) {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/v1/share/session",
        payload: { token: "invalid-token-0123456789" },
      });
      expect(rejected.statusCode).toBe(401);
    } // 共 10 次，窗口已满

    const limited = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token: tokenA } });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("SHARE_EXCHANGE_RATE_LIMITED");
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // 私密数据不得缓存（05 §7）。
    expect(limited.headers["cache-control"]).toBe("no-store");

    // 05 §6.2/6.3：GET/DELETE 不参与交换限流。
    const restored = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(restored.statusCode).toBe(200);
    const removed = await app.inject({ method: "DELETE", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(removed.statusCode).toBe(204);

    // 限流按 IP：其他来源不受影响。
    const otherIp = await app.inject({
      method: "POST",
      url: "/api/v1/share/session",
      payload: { token: tokenB },
      remoteAddress: "10.0.0.9",
    });
    expect(otherIp.statusCode).toBe(201);
  });
});

describe("GET /share/session（会话恢复）", () => {
  it("有效 Cookie 恢复成员身份，且响应 no-store", async () => {
    const cookieA = await exchangeCookie(app, tokenA);
    const response = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(response.statusCode).toBe(200);
    expect(response.json().member.name).toBe("陈晨");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).not.toContain(tokenA);
    expect(response.body).not.toContain("verifier");
  });

  it("非 session share 端点无会话一律 401 SHARE_SESSION_REQUIRED（preHandler 统一解析）", async () => {
    const urls = [
      "/api/v1/share/tasks?view=home",
      "/api/v1/share/tasks?view=tracker",
      "/api/v1/share/tasks/00000000-0000-4000-8000-000000000000",
      "/api/v1/share/folders/tree",
    ];
    for (const url of urls) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
      expect(response.json().error.code).toBe("SHARE_SESSION_REQUIRED");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("无 Cookie / 伪造 Cookie 返回 401 SHARE_SESSION_REQUIRED", async () => {
    for (const headers of [{}, { cookie: "ztask_share_session=not-a-session" }]) {
      const response = await app.inject({ method: "GET", url: "/api/v1/share/session", headers });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("SHARE_SESSION_REQUIRED");
      expect(response.headers["cache-control"]).toBe("no-store");
    }
  });

  it("会话过期（expiresAt 已过）→ 401", async () => {
    const cookieA = await exchangeCookie(app, tokenA);
    await updateSessionFile(dataDir, sessionIdOf(cookieA), {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const response = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SHARE_SESSION_REQUIRED");
  });

  it("expiresAt 损坏时 fail-closed：不得让会话永久有效", async () => {
    const cookieA = await exchangeCookie(app, tokenA);
    await updateSessionFile(dataDir, sessionIdOf(cookieA), { expiresAt: "not-a-date" });
    const response = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SHARE_SESSION_REQUIRED");
  });

  it("成员归档后既有会话下一请求 401", async () => {
    const cookieB = await exchangeCookie(app, tokenB);
    const archived = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberB}` });
    expect(archived.statusCode).toBe(204);

    const restored = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieB } });
    expect(restored.statusCode).toBe(401);
    const tasks = await app.inject({ method: "GET", url: "/api/v1/share/tasks?view=home", headers: { cookie: cookieB } });
    expect(tasks.statusCode).toBe(401);
  });

  it("链接重置为 revoked 后旧会话立即失效（link 状态兜底）", async () => {
    const cookieA = await exchangeCookie(app, tokenA);
    await updateShareLink(dataDir, memberA, { status: "revoked" });

    const response = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(response.statusCode).toBe(401);
  });
});

describe("DELETE /share/session（注销）", () => {
  it("注销后 Cookie 清除且旧会话失效；无会话时也幂等 204", async () => {
    const cookieA = await exchangeCookie(app, tokenA);
    const removed = await app.inject({ method: "DELETE", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(removed.statusCode).toBe(204);
    expect(String(removed.headers["set-cookie"])).toContain("Max-Age=0");

    const restored = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(restored.statusCode).toBe(401);

    const anonymous = await app.inject({ method: "DELETE", url: "/api/v1/share/session" });
    expect(anonymous.statusCode).toBe(204);
  });
});

describe("链接与会话时间戳节流（07 §3.2 / 06 §5）", () => {
  it("交换成功写 lastUsedAt；60s 窗口内再次交换不重写", async () => {
    const before = await readShareLink(dataDir, memberA);
    expect(before.lastUsedAt).toBeNull();

    await exchangeCookie(app, tokenA);
    const afterFirst = await readShareLink(dataDir, memberA);
    expect(afterFirst.lastUsedAt).not.toBeNull();
    // 其余字段保留（07 §3.2 第 3 步）。
    expect(afterFirst.id).toBe(before.id);
    expect(afterFirst.tokenHash).toBe(before.tokenHash);
    expect(afterFirst.status).toBe("active");
    expect(afterFirst.createdAt).toBe(before.createdAt);

    await exchangeCookie(app, tokenA);
    const afterSecond = await readShareLink(dataDir, memberA);
    expect(afterSecond.lastUsedAt).toBe(afterFirst.lastUsedAt);
  });

  it("lastSeenAt 心跳节流：过期心跳会被写回，窗口内不重写", async () => {
    const cookieA = await exchangeCookie(app, tokenA);
    const sessionId = sessionIdOf(cookieA);
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await updateSessionFile(dataDir, sessionId, { lastSeenAt: stale });

    const response = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    expect(response.statusCode).toBe(200);
    const refreshed = await readSessionFile(dataDir, sessionId);
    expect(refreshed.lastSeenAt).not.toBe(stale);

    await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: cookieA } });
    const second = await readSessionFile(dataDir, sessionId);
    expect(second.lastSeenAt).toBe(refreshed.lastSeenAt);
  });
});
