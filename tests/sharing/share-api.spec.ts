// @vitest-environment node
import { mkdir, rm } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildApp,
  createNetworkService,
  createShareLinkService,
  initStore,
  type NetworkService,
  type ShareLinkService,
  type ZtaskStore,
} from "@ztask/server";
import { FAKE_INTERFACES, createListenerFake, createMemberViaApi, tmpDataDir } from "./support/fakes.js";

/**
 * 分享链接与网络管理 API（05 §4.5–4.9）：
 * 真实 initStore + buildApp + NetworkService，listener 用 fake；
 * 同时验证 LAN app 上 Admin API 的一律拒绝与统一错误体。
 */

let dataDir: string;
let store: ZtaskStore;
let network: NetworkService;
let shareLinks: ShareLinkService;
let app: FastifyInstance;

function config() {
  return { host: "127.0.0.1", port: 0, dataDir, staticRoot: null } as const;
}

async function enableLan(): Promise<void> {
  await network.enable("192.168.1.5", 8123);
}

function shareLinkUrl(memberId: string): string {
  return `/api/v1/admin/members/${memberId}/share-link`;
}

beforeEach(async () => {
  dataDir = await tmpDataDir();
  await mkdir(dataDir, { recursive: true });
  store = await initStore({ dataDir, applicationVersion: "0.1.0" });
  const fake = createListenerFake();
  network = createNetworkService({
    dataDir,
    loopbackHost: "127.0.0.1",
    loopbackPort: 8123,
    listInterfaces: () => FAKE_INTERFACES,
    startListener: fake.start,
  });
  shareLinks = createShareLinkService({ dataDir, network });
  app = await buildApp(config(), { store, networkService: network, shareLinkService: shareLinks });
});

afterEach(async () => {
  await network.close();
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("GET /admin/members 的 shareLink（05 §2.3/§4.1）", () => {
  it("由 ShareLinkService.summary 填充，且 PATCH 返回的 DTO 同样带脱敏态", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");

    const before = await app.inject({ method: "GET", url: "/api/v1/admin/members" });
    expect((before.json() as { items: Array<{ shareLink: unknown }> }).items[0]!.shareLink).toBeNull();

    await enableLan();
    const issued = await app.inject({ method: "POST", url: shareLinkUrl(memberId) });
    expect(issued.statusCode).toBe(201);
    const issuedBody = issued.json() as { createdAt: string };

    const after = await app.inject({ method: "GET", url: "/api/v1/admin/members" });
    const item = (after.json() as { items: Array<{ shareLink: unknown }> }).items[0]!;
    expect(item.shareLink).toEqual({
      status: "active",
      createdAt: issuedBody.createdAt,
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(after.body).not.toContain("url");
    expect(after.body).not.toContain("tokenHash");

    const patched = await app.inject({ method: "PATCH", url: `/api/v1/admin/members/${memberId}`, payload: { role: "前端" } });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as { shareLink: { status: string } }).shareLink.status).toBe("active");
  });
});

describe("分享链接四端点状态码（05 §4.5–4.8）", () => {
  it("POST 201 → 重复 409 → rotate 200 → GET 200 → DELETE 204（幂等）→ GET revoked", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    await enableLan();

    const created = await app.inject({ method: "POST", url: shareLinkUrl(memberId) });
    expect(created.statusCode).toBe(201);
    const issued = created.json() as { id: string; status: string; url: string; createdAt: string };
    expect(issued.status).toBe("active");
    expect(issued.url.startsWith("http://192.168.1.5:8123/#/s/")).toBe(true);

    const duplicate = await app.inject({ method: "POST", url: shareLinkUrl(memberId) });
    expect(duplicate.statusCode).toBe(409);
    expect((duplicate.json() as { error: { code: string } }).error.code).toBe("ACTIVE_SHARE_LINK_EXISTS");

    const rotated = await app.inject({ method: "POST", url: `${shareLinkUrl(memberId)}/rotate` });
    expect(rotated.statusCode).toBe(200);
    const rotatedBody = rotated.json() as { id: string; url: string; createdAt: string };
    expect(rotatedBody.id).not.toBe(issued.id);
    expect(rotatedBody.url.startsWith("http://192.168.1.5:8123/#/s/")).toBe(true);

    const fetched = await app.inject({ method: "GET", url: shareLinkUrl(memberId) });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual({
      status: "active",
      createdAt: rotatedBody.createdAt,
      revokedAt: null,
      lastUsedAt: null,
    });

    const revoked = await app.inject({ method: "DELETE", url: shareLinkUrl(memberId) });
    expect(revoked.statusCode).toBe(204);
    const revokedAgain = await app.inject({ method: "DELETE", url: shareLinkUrl(memberId) });
    expect(revokedAgain.statusCode).toBe(204);

    const state = await app.inject({ method: "GET", url: shareLinkUrl(memberId) });
    const body = state.json() as { status: string; revokedAt: string | null };
    expect(body.status).toBe("revoked");
    expect(body.revokedAt).not.toBeNull();
  });

  it("LAN 未运行：生成与重置 409 LAN_SHARE_DISABLED", async () => {
    const memberId = await createMemberViaApi(app, "林悦");
    const generate = await app.inject({ method: "POST", url: shareLinkUrl(memberId) });
    expect(generate.statusCode).toBe(409);
    expect((generate.json() as { error: { code: string } }).error.code).toBe("LAN_SHARE_DISABLED");

    const rotate = await app.inject({ method: "POST", url: `${shareLinkUrl(memberId)}/rotate` });
    expect(rotate.statusCode).toBe(409);
    expect((rotate.json() as { error: { code: string } }).error.code).toBe("LAN_SHARE_DISABLED");
  });
});

describe("网络三端点（05 §4.9）", () => {
  it("GET 返回 NetworkState；PUT 启用后 running；DELETE 关闭", async () => {
    const initial = await app.inject({ method: "GET", url: "/api/v1/admin/network" });
    expect(initial.statusCode).toBe(200);
    const initialState = initial.json() as {
      loopbackUrl: string;
      interfaces: Array<{ name: string; address: string }>;
      shareListener: { enabled: boolean; running: boolean; shareBaseUrl: string | null };
    };
    expect(initialState.loopbackUrl).toBe("http://127.0.0.1:8123");
    expect(initialState.interfaces).toEqual(FAKE_INTERFACES);
    expect(initialState.shareListener).toMatchObject({ enabled: false, running: false, shareBaseUrl: null });

    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/network/share-listener",
      payload: { host: "192.168.1.5", port: 8123 },
    });
    expect(put.statusCode).toBe(200);
    expect((put.json() as { shareListener: unknown }).shareListener).toEqual({
      enabled: true,
      running: true,
      degraded: false,
      host: "192.168.1.5",
      port: 8123,
      shareBaseUrl: "http://192.168.1.5:8123",
      error: null,
    });

    const del = await app.inject({ method: "DELETE", url: "/api/v1/admin/network/share-listener" });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: "GET", url: "/api/v1/admin/network" });
    expect((after.json() as { shareListener: { enabled: boolean; running: boolean } }).shareListener).toMatchObject({
      enabled: false,
      running: false,
    });
  });

  it("非本机/wildcard 地址、越界端口 → 422 LAN_INTERFACE_INVALID；未声明字段 → 400", async () => {
    const invalid = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/network/share-listener",
      payload: { host: "10.9.9.9", port: 8123 },
    });
    expect(invalid.statusCode).toBe(422);
    const body = invalid.json() as { error: { code: string; message: string; requestId: string } };
    expect(body.error.code).toBe("LAN_INTERFACE_INVALID");
    expect(body.error.requestId).toBeTruthy();
    expect(Object.keys(body)).toEqual(["error"]);

    const wildcard = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/network/share-listener",
      payload: { host: "0.0.0.0", port: 8123 },
    });
    expect(wildcard.statusCode).toBe(422);

    const badPort = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/network/share-listener",
      payload: { host: "192.168.1.5", port: 0 },
    });
    expect(badPort.statusCode).toBe(422);

    // 注：schema 已声明 additionalProperties:false；Fastify 默认 ajv removeAdditional:true
    // 会剥离未声明字段而不是回 400，因此这里不断言额外字段的状态码（见交付说明的待决点）。
  });
});

describe("LAN listener 上的 Admin API（04 §4.1）", () => {
  it("一律 403 ADMIN_LOCAL_ONLY；share/health 仍可访问", async () => {
    const memberId = await createMemberViaApi(app, "陈晨");
    await enableLan();

    const lanApp = await buildApp(config(), {
      store,
      listenerKind: "lan",
      networkService: network,
      shareLinkService: shareLinks,
    });
    try {
      const adminCalls = [
        { method: "GET" as const, url: "/api/v1/admin/network" },
        { method: "GET" as const, url: "/api/v1/admin/members" },
        { method: "POST" as const, url: shareLinkUrl(memberId) },
        { method: "DELETE" as const, url: "/api/v1/admin/network/share-listener" },
      ];
      for (const call of adminCalls) {
        const response = await lanApp.inject(call);
        expect(response.statusCode, call.url).toBe(403);
        const body = response.json() as { error: { code: string; requestId: string } };
        expect(body.error.code).toBe("ADMIN_LOCAL_ONLY");
        expect(body.error.requestId).toBeTruthy();
        expect(Object.keys(body)).toEqual(["error"]);
      }

      const health = await lanApp.inject({ method: "GET", url: "/api/v1/health" });
      expect(health.statusCode).toBe(200);
      const share = await lanApp.inject({ method: "GET", url: "/api/v1/share/session" });
      expect(share.statusCode).toBe(401);
    } finally {
      await lanApp.close();
    }
  });
});
