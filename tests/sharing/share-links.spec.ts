// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, createShareLinkService, initStore, type ShareLinkService } from "@ztask/server";
import {
  createMemberViaApi,
  createStubNetworkService,
  exchangeCookie,
  tokenFromUrl,
  tmpDataDir,
  type StubNetworkService,
} from "./support/fakes.js";

/**
 * 分享链接生命周期（07 §7、06 §4.3）：token 不落盘、409 语义、轮换/吊销立即失效旧会话。
 * 会话失效通过真实 `POST/GET /share/session` 验证，而不是只检查文件。
 */

let dataDir: string;
let app: FastifyInstance;
let network: StubNetworkService;
let service: ShareLinkService;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

interface LinkFile {
  formatVersion: number;
  id: string;
  memberId: string;
  tokenHash: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

async function readLinkFile(memberId: string): Promise<LinkFile> {
  return JSON.parse(await readFile(path.join(dataDir, "share-links", `${memberId}.json`), "utf8")) as LinkFile;
}

async function sessionFiles(): Promise<string[]> {
  try {
    return (await readdir(path.join(dataDir, "auth-sessions"))).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
}

async function issue(memberId: string): Promise<{ id: string; url: string; createdAt: string }> {
  const response = await app.inject({ method: "POST", url: `/api/v1/admin/members/${memberId}/share-link` });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string; url: string; createdAt: string };
}

beforeEach(async () => {
  dataDir = await tmpDataDir();
  await mkdir(dataDir, { recursive: true });
  const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  network = createStubNetworkService({ running: true });
  service = createShareLinkService({ dataDir, network });
  app = await buildApp(
    { host: "127.0.0.1", port: 0, dataDir, staticRoot: null },
    { store, networkService: network, shareLinkService: service },
  );
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("generate（05 §4.5、07 §7）", () => {
  it("落盘只含 tokenHash，不含 raw token 或完整 URL", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    const issued = await issue(memberId);
    const token = tokenFromUrl(issued.url);

    expect(issued.url).toBe(`http://192.168.1.5:8123/#/s/${token}`);

    const raw = await readFile(path.join(dataDir, "share-links", `${memberId}.json`), "utf8");
    expect(raw).not.toContain(token);
    expect(raw).not.toContain("192.168.1.5");

    const file = JSON.parse(raw) as LinkFile;
    expect(file).toEqual({
      formatVersion: 1,
      id: issued.id,
      memberId,
      tokenHash: sha256Hex(token),
      status: "active",
      createdAt: issued.createdAt,
      revokedAt: null,
      lastUsedAt: null,
    });
  });

  it("已有 active 链接 → 409 ACTIVE_SHARE_LINK_EXISTS（错误体为统一嵌套结构）", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    await issue(memberId);

    const response = await app.inject({ method: "POST", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(response.statusCode).toBe(409);
    const body = response.json() as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe("ACTIVE_SHARE_LINK_EXISTS");
    expect(body.error.requestId).toBeTruthy();
    expect(Object.keys(body)).toEqual(["error"]);
  });

  it("LAN 未 running → 409 LAN_SHARE_DISABLED，且不写链接文件", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    network.setRunning(false);

    const response = await app.inject({ method: "POST", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { code: string } }).error.code).toBe("LAN_SHARE_DISABLED");
    await expect(readFile(path.join(dataDir, "share-links", `${memberId}.json`), "utf8")).rejects.toThrow();
  });

  it("成员不存在 → 404；已归档成员 → 404", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/admin/members/11111111-1111-4111-8111-111111111111/share-link",
    });
    expect(missing.statusCode).toBe(404);
    expect((missing.json() as { error: { code: string } }).error.code).toBe("NOT_FOUND");

    const memberId = await createMemberViaApi(app, "林悦");
    await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberId}` });
    const archived = await app.inject({ method: "POST", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(archived.statusCode).toBe(404);
  });
});

  it("token 为 32 字节 CSPRNG 的 base64url（43 字符）且每次不同，磁盘只存 64 位十六进制哈希", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    const first = tokenFromUrl((await issue(memberId)).url);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rotated = await app.inject({
      method: "POST",
      url: `/api/v1/admin/members/${memberId}/share-link/rotate`,
    });
    expect(rotated.statusCode).toBe(200);
    const second = tokenFromUrl((rotated.json() as { url: string }).url);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);

    const file = await readLinkFile(memberId);
    expect(file.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(file.tokenHash).toBe(sha256Hex(second));
    expect(JSON.stringify(file)).not.toContain(second);
  });

describe("rotate（05 §4.6、07 §7）", () => {
  it("换新 id/tokenHash，旧 token 与旧 Cookie 立即失效", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    const issued = await issue(memberId);
    const oldToken = tokenFromUrl(issued.url);
    const oldCookie = await exchangeCookie(app, oldToken);

    const alive = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: oldCookie } });
    expect(alive.statusCode).toBe(200);

    const rotatedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/admin/members/${memberId}/share-link/rotate`,
    });
    expect(rotatedResponse.statusCode).toBe(200);
    const rotated = rotatedResponse.json() as { id: string; url: string; createdAt: string };
    const newToken = tokenFromUrl(rotated.url);
    expect(rotated.id).not.toBe(issued.id);
    expect(newToken).not.toBe(oldToken);

    const file = await readLinkFile(memberId);
    expect(file.id).toBe(rotated.id);
    expect(file.tokenHash).toBe(sha256Hex(newToken));
    expect(file.status).toBe("active");

    // 旧会话文件被清理，且即使残留也会因 shareLinkId 不匹配被拒。
    expect(await sessionFiles()).toEqual([]);
    const staleCookie = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: oldCookie } });
    expect(staleCookie.statusCode).toBe(401);
    expect((staleCookie.json() as { error: { code: string } }).error.code).toBe("SHARE_SESSION_REQUIRED");

    const staleToken = await app.inject({ method: "POST", url: "/api/v1/share/session", payload: { token: oldToken } });
    expect(staleToken.statusCode).toBe(401);
    expect((staleToken.json() as { error: { code: string } }).error.code).toBe("SHARE_LINK_INVALID");

    const freshCookie = await exchangeCookie(app, newToken);
    const fresh = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: freshCookie } });
    expect(fresh.statusCode).toBe(200);
  });

  it("会话文件被保留/恢复也不能绕过 rotate：shareLinkId 不匹配一律 401", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    const issued = await issue(memberId);
    const oldCookie = await exchangeCookie(app, tokenFromUrl(issued.url));

    // 抓住轮换前的会话文件内容，轮换后人为放回：模拟删除失败/备份恢复的残留。
    const names = await sessionFiles();
    expect(names).toHaveLength(1);
    const sessionPath = path.join(dataDir, "auth-sessions", names[0]!);
    const saved = await readFile(sessionPath, "utf8");

    const rotated = await app.inject({
      method: "POST",
      url: `/api/v1/admin/members/${memberId}/share-link/rotate`,
    });
    expect(rotated.statusCode).toBe(200);
    expect(await sessionFiles()).toEqual([]);

    await writeFile(sessionPath, saved, "utf8");
    expect(await sessionFiles()).toEqual([names[0]!]);
    const stale = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie: oldCookie } });
    expect(stale.statusCode).toBe(401);
    expect((stale.json() as { error: { code: string } }).error.code).toBe("SHARE_SESSION_REQUIRED");
  });

  it("LAN 未 running → 409 LAN_SHARE_DISABLED", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    await issue(memberId);
    network.setRunning(false);
    const response = await app.inject({ method: "POST", url: `/api/v1/admin/members/${memberId}/share-link/rotate` });
    expect(response.statusCode).toBe(409);
    expect((response.json() as { error: { code: string } }).error.code).toBe("LAN_SHARE_DISABLED");
  });
});

describe("revoke（05 §4.7）", () => {
  it("吊销后旧会话失效；重复吊销幂等 204", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    const issued = await issue(memberId);
    const cookie = await exchangeCookie(app, tokenFromUrl(issued.url));

    const first = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(first.statusCode).toBe(204);
    const file = await readLinkFile(memberId);
    expect(file.status).toBe("revoked");
    expect(file.revokedAt).not.toBeNull();
    expect(file.id).toBe(issued.id);
    expect(await sessionFiles()).toEqual([]);

    const second = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(second.statusCode).toBe(204);
    expect((await readLinkFile(memberId)).revokedAt).toBe(file.revokedAt);

    const denied = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie } });
    expect(denied.statusCode).toBe(401);
  });

  it("从未生成时吊销也是 204（幂等）", async () => {
    const memberId = await createMemberViaApi(app, "林悦");
    const response = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(response.statusCode).toBe(204);
  });
});

describe("get（05 §4.8）", () => {
  it("none → active → revoked，且 never 返回 url/tokenHash", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");

    const none = await app.inject({ method: "GET", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ status: "none" });

    const issued = await issue(memberId);
    const active = await app.inject({ method: "GET", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(active.json()).toEqual({
      status: "active",
      createdAt: issued.createdAt,
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(active.body).not.toContain("url");
    expect(active.body).not.toContain("tokenHash");

    await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberId}/share-link` });
    const revoked = await app.inject({ method: "GET", url: `/api/v1/admin/members/${memberId}/share-link` });
    const body = revoked.json() as { status: string; revokedAt: string | null; createdAt: string };
    expect(body.status).toBe("revoked");
    expect(body.revokedAt).not.toBeNull();
    expect(body.createdAt).toBe(issued.createdAt);
  });
});

describe("归档成员（07 §7.1）", () => {
  it("归档先吊销链接并删除会话，之后不能再生成", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    const issued = await issue(memberId);
    const cookie = await exchangeCookie(app, tokenFromUrl(issued.url));
    expect(await sessionFiles()).toHaveLength(1);

    const removed = await app.inject({ method: "DELETE", url: `/api/v1/admin/members/${memberId}` });
    expect(removed.statusCode).toBe(204);

    const file = await readLinkFile(memberId);
    expect(file.status).toBe("revoked");
    expect(file.revokedAt).not.toBeNull();
    expect(await sessionFiles()).toEqual([]);

    const denied = await app.inject({ method: "GET", url: "/api/v1/share/session", headers: { cookie } });
    expect(denied.statusCode).toBe(401);

    const regenerate = await app.inject({ method: "POST", url: `/api/v1/admin/members/${memberId}/share-link` });
    expect(regenerate.statusCode).toBe(404);

    // rotate 同样不能给已归档成员留下 active 链接（06 §8 的顺序边界）。
    const rotate = await app.inject({ method: "POST", url: `/api/v1/admin/members/${memberId}/share-link/rotate` });
    expect(rotate.statusCode).toBe(404);
    expect((await readLinkFile(memberId)).status).toBe("revoked");
  });
});
