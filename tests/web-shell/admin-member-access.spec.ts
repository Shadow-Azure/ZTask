// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://192.168.1.5:8123"}
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "../../apps/web/src/App.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

/**
 * 局域网管理页入口（m17）：管理壳先恢复分享会话，只有管理员成员才渲染管理内容；
 * 普通成员、无会话与恢复失败各自给出明确页面，且不提前请求任何 Admin API。
 */

const ADMIN = { id: "m-admin", name: "陈晨", role: "", color: "#2f6fe0" };
const MEMBER = { id: "m-member", name: "林悦", role: "", color: "#1f9d6b" };

interface SessionState {
  member: typeof ADMIN;
  isAdmin: boolean;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function networkState(): unknown {
  return {
    loopbackUrl: "http://127.0.0.1:8123",
    interfaces: [],
    shareListener: { enabled: true, running: true, degraded: false, host: "192.168.1.5", port: 8123, shareBaseUrl: "http://192.168.1.5:8123", error: null },
  };
}

/** 记录 Admin API 调用，用于断言被门控拒绝时不发管理请求。 */
let adminCalls: string[] = [];

/**
 * 模拟 LAN 上的分享会话与只读管理端点。
 * @param session 恢复会话的响应；null 表示 401。
 */
function installFetch(session: SessionState | null): void {
  adminCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/api/v1/admin/")) adminCalls.push(url.pathname);
    if (url.pathname === "/api/v1/share/session") {
      if ((init?.method ?? "GET") === "POST") {
        return jsonResponse(201, { member: ADMIN, isAdmin: true });
      }
      if (session === null) {
        return jsonResponse(401, { error: { code: "SHARE_SESSION_REQUIRED", message: "需要成员会话", requestId: "r-1" } });
      }
      return jsonResponse(200, session);
    }
    if (url.pathname === "/api/v1/admin/network") return jsonResponse(200, networkState());
    if (url.pathname === "/api/v1/admin/folders/tree") return jsonResponse(200, { tree: [] });
    if (url.pathname === "/api/v1/admin/tasks") return jsonResponse(200, { items: [], nextCursor: null });
    if (url.pathname === "/api/v1/admin/members") return jsonResponse(200, { items: [] });
    return jsonResponse(200, {});
  }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountAt(path: string) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  await nextTick();
  return { wrapper, router };
}

describe("LAN 管理页入口", () => {
  it("管理员成员：恢复会话后渲染管理导航与成员身份", async () => {
    installFetch({ member: ADMIN, isAdmin: true });
    const { wrapper } = await mountAt("/tracker");

    await vi.waitFor(() => expect(wrapper.find('[aria-label="管理导航"]').exists()).toBe(true));
    expect(wrapper.text()).toContain("陈晨");
    expect(wrapper.text()).toContain("注销");
    expect(wrapper.text()).toContain("＋ 新建任务夹");
    expect(adminCalls).toContain("/api/v1/admin/folders/tree");
    wrapper.unmount();
  });

  it("普通成员：显示没有管理员权限，且不请求 Admin API", async () => {
    installFetch({ member: MEMBER, isAdmin: false });
    const { wrapper } = await mountAt("/tracker");

    await vi.waitFor(() => expect(wrapper.text()).toContain("没有管理员权限"));
    expect(wrapper.find('[aria-label="管理导航"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");
    expect(adminCalls).toEqual([]);
    wrapper.unmount();
  });

  it("无会话：提示从服务主机打开或使用管理员链接，且不请求 Admin API", async () => {
    installFetch(null);
    const { wrapper } = await mountAt("/tracker");

    await vi.waitFor(() => expect(wrapper.text()).toContain("需要管理员会话"));
    expect(wrapper.text()).toContain("从服务主机本机打开");
    expect(adminCalls).toEqual([]);
    wrapper.unmount();
  });

  it("管理员分享链接：交换成功后进入管理页而不是成员个人页", async () => {
    installFetch({ member: ADMIN, isAdmin: true });
    const { wrapper, router } = await mountAt("/s/good-token-0123456789");

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/tracker"));
    await vi.waitFor(() => expect(wrapper.find('[aria-label="管理导航"]').exists()).toBe(true));
    expect(router.currentRoute.value.fullPath).not.toContain("good-token");
    wrapper.unmount();
  });
});
