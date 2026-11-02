// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import App from "../../apps/web/src/App.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

let router: ReturnType<typeof createAppRouter> | undefined;

const MEMBER = { id: "m-a", name: "陈晨", role: "", color: "#2f6fe0" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * 分享域 fetch 桩：会话交换/恢复 + 个人页与任务夹树。
 * 只用于成员壳测试；管理端测试不安装它，继续走真实（失败的）网络路径。
 * @param member 会话恢复返回的成员摘要。
 */
function installShareFetch(member = MEMBER): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/api/v1/share/session")) {
      if (method === "POST") {
        const token = (JSON.parse(String(init?.body ?? "{}")) as { token?: string }).token;
        if (token === "good-token") return jsonResponse(201, { member });
        return jsonResponse(401, { error: { code: "SHARE_LINK_INVALID", message: "分享链接无效", requestId: "r-1" } });
      }
      return jsonResponse(200, { member });
    }
    if (url.includes("/api/v1/share/tasks")) {
      const view = new URL(url).searchParams.get("view");
      return jsonResponse(200, view === "tracker" ? { items: [], nextCursor: null } : { owned: [], collaborated: [] });
    }
    if (url.includes("/api/v1/share/folders/tree")) return jsonResponse(200, { tree: [] });
    return jsonResponse(200, { tree: [] });
  }) as typeof fetch;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  localStorage.clear();
});

async function mountAt(path: string) {
  const appRouter = createAppRouter();
  router = appRouter;
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]],
    },
  });
  await nextTick();
  return { wrapper, router };
}

describe("路由与访问模式（03 §2）", () => {
  it("管理壳：事项跟踪/成员管理导航齐全，跟踪页渲染管理控件", async () => {
    const { wrapper } = await mountAt("/tracker");
    const nav = wrapper.find('[aria-label="管理导航"]');
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toContain("事项跟踪");
    expect(nav.text()).toContain("成员管理");
    expect(wrapper.text()).toContain("＋ 新建任务夹");
    expect(wrapper.text()).toContain("＋ 新建任务");
    wrapper.unmount();
  });

  it("根路径重定向到 /tracker", async () => {
    const { router } = await mountAt("/");
    expect(router.currentRoute.value.path).toBe("/tracker");
  });

  it("成员壳：会话恢复后只有成员个人页/事项跟踪，绝不出现成员管理", async () => {
    installShareFetch();
    const { wrapper } = await mountAt("/s/home");
    await vi.waitFor(() => expect(wrapper.text()).toContain("你好，陈晨"));

    const nav = wrapper.find('[aria-label="成员导航"]');
    expect(nav.exists()).toBe(true);
    const navLinks = nav.findAll("a");
    expect(navLinks.map((link) => link.text())).toEqual(["成员个人页", "事项跟踪"]);
    expect(nav.text()).not.toContain("注销");
    expect(wrapper.find(".share-user").text()).toContain("陈晨");
    expect(wrapper.find(".share-user").find("button").text()).toBe("注销");
    expect(wrapper.text()).not.toContain("成员管理");
    expect(wrapper.text()).not.toContain("＋ 添加成员");
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");

    await vi.waitFor(() => expect(wrapper.text()).toContain("暂无你负责的任务"));
    expect(wrapper.text()).toContain("暂无你协作的任务");
    expect(wrapper.findAll("button")).toHaveLength(1);
    wrapper.unmount();
  });

  it("成员只读跟踪页：不渲染任何新建控件", async () => {
    installShareFetch();
    const { wrapper } = await mountAt("/s/tracker");
    // 只读文案在不同实现措辞下可能是「只读视图 · …」或「成员视图为只读；…」，
    // 这里只断言只读语义与零写控件，避免锁死具体措辞。
    await vi.waitFor(() => expect(wrapper.find(".tracker").exists()).toBe(true));
    expect(wrapper.text()).toContain("只读");
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");
    expect(wrapper.text()).not.toContain("＋ 新建任务");
    wrapper.unmount();
  });

  it("分享令牌页：交换成功后清除 fragment token，最终停在 /s/home", async () => {
    const token = "good-token";
    installShareFetch();
    const { wrapper, router } = await mountAt(`/s/${token}`);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/s/home"));
    await vi.waitFor(() => expect(wrapper.text()).toContain("你好，陈晨"));

    expect(router.currentRoute.value.params.token).toBeUndefined();
    expect(router.currentRoute.value.fullPath).not.toContain(token);
    expect(wrapper.html()).not.toContain(token);
    expect(document.body.innerHTML).not.toContain(token);
    expect(JSON.stringify({ ...localStorage })).not.toContain(token);
    wrapper.unmount();
  });

  it("失效令牌：进入失效页且不回显 token", async () => {
    const token = "bad-token";
    installShareFetch();
    const { wrapper, router } = await mountAt(`/s/${token}`);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/share-invalid"));
    await vi.waitFor(() => expect(wrapper.text()).toContain("链接已失效"));

    expect(router.currentRoute.value.params.token).toBeUndefined();
    expect(wrapper.html()).not.toContain(token);
    expect(document.body.innerHTML).not.toContain(token);
    wrapper.unmount();
  });

  it("失效链接页：无任何业务导航", async () => {
    const { wrapper } = await mountAt("/share-invalid");
    expect(wrapper.text()).toContain("链接已失效");
    expect(wrapper.find('[aria-label="管理导航"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="成员导航"]').exists()).toBe(false);
    expect(wrapper.findAll("a")).toHaveLength(0);
    wrapper.unmount();
  });

  it("未知路径重定向到 /tracker", async () => {
    const { router } = await mountAt("/no-such-page");
    expect(router.currentRoute.value.path).toBe("/tracker");
  });
});
