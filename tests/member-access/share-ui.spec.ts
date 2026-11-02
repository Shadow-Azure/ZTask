// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import App from "../../apps/web/src/App.vue";
import type { FolderTreeNode, MemberSummary, Task } from "@ztask/shared";

/**
 * 成员壳与成员个人页的前端行为（08 §6.1–§6.2、§7）：
 * 令牌交换后清除 fragment、注销清理 share 缓存、只读个人页零控件、401 统一进失效页。
 */

const MEMBER: MemberSummary = { id: "m-a", name: "陈晨", role: "前端", color: "#2f6fe0" };
const OTHER: MemberSummary = { id: "m-b", name: "李雷", role: "后端", color: "#d97b1c" };
const THIRD: MemberSummary = { id: "m-c", name: "韩梅梅", role: "设计", color: "#8a55c9" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function emptyTree(): { tree: FolderTreeNode[] } {
  return { tree: [] };
}

function makeTask(overrides: Partial<Task> & Pick<Task, "id" | "description">): Task {
  return {
    folderId: "f-root",
    parentId: null,
    owners: [MEMBER],
    collaborators: [],
    progress: 40,
    detail: "第一条进展\n第二条进展",
    importance: "mid",
    dueDate: null,
    version: 1,
    createdAt: "2026-11-01T01:00:00.000Z",
    updatedAt: "2026-11-01T01:00:00.000Z",
    subtasks: [],
    ...overrides,
  };
}

const FOLDER_TREE: FolderTreeNode[] = [
  {
    id: "f-root",
    parentId: null,
    name: "迭代",
    position: 0,
    tasks: [],
    counts: { done: 0, todo: 0 },
    children: [
      {
        id: "f-sub",
        parentId: "f-root",
        name: "子夹",
        position: 0,
        tasks: [],
        counts: { done: 0, todo: 0 },
        children: [],
      },
    ],
  },
];

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  localStorage.clear();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function mountApp(path: string, queryClient = createAppQueryClient()) {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient }]] },
    attachTo: document.body,
  });
  await nextTick();
  return { wrapper, router, queryClient };
}

describe("ShareSessionPage（令牌交换）", () => {
  it("交换成功：replace 到 /s/home，原始 token 不进入 DOM 或 localStorage", async () => {
    const token = "good-token-123";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/share/session")) {
        if ((init?.method ?? "GET") === "POST") return jsonResponse(201, { member: MEMBER });
        return jsonResponse(200, { member: MEMBER });
      }
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, { owned: [], collaborated: [] });
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;

    const { wrapper, router } = await mountApp(`/s/${token}`);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/s/home"));
    await vi.waitFor(() => expect(wrapper.text()).toContain("你好，陈晨"));

    expect(router.currentRoute.value.params.token).toBeUndefined();
    expect(wrapper.html()).not.toContain(token);
    expect(document.body.innerHTML).not.toContain(token);
    expect(JSON.stringify({ ...localStorage })).not.toContain(token);
    wrapper.unmount();
  });

  it("交换失败：进入失效页", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/share/session")) {
        return jsonResponse(401, { error: { code: "SHARE_LINK_INVALID", message: "分享链接无效", requestId: "r-1" } });
      }
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;

    const { wrapper, router } = await mountApp("/s/bad-token");
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/share-invalid"));
    await vi.waitFor(() => expect(wrapper.text()).toContain("链接已失效"));
    expect(wrapper.text()).toContain("该分享链接已被管理员重置或吊销。");
    expect(wrapper.text()).toContain("请联系管理员获取新的访问链接。");
    wrapper.unmount();
  });
});

describe("ShareLayout（成员壳）", () => {
  it("注销：调用 DELETE、清理 share 缓存并进入失效页", async () => {
    const queryClient = createAppQueryClient();
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    const methods: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      methods.push(`${method} ${url}`);
      if (url.includes("/api/v1/share/session")) {
        if (method === "DELETE") return new Response(null, { status: 204 });
        return jsonResponse(200, { member: MEMBER });
      }
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, { owned: [], collaborated: [] });
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;

    const { wrapper, router } = await mountApp("/s/home", queryClient);
    await vi.waitFor(() => expect(wrapper.find(".share-user").exists()).toBe(true));
    expect(wrapper.find(".share-user").text()).toContain("陈晨");

    await wrapper.find(".share-user button").trigger("click");
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/share-invalid"));

    expect(methods.some((entry) => entry.startsWith("DELETE ") && entry.includes("/share/session"))).toBe(true);
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ["share"] });
    expect(queryClient.getQueryData(["share", "tasks", "home"])).toBeUndefined();
    expect(wrapper.find('[aria-label="成员导航"]').exists()).toBe(false);
    // 主动退出不应被描述成"链接被吊销"：同一页面换中性文案（?from=logout）。
    expect(router.currentRoute.value.query.from).toBe("logout");
    expect(wrapper.text()).toContain("已退出成员视图");
    expect(wrapper.text()).not.toContain("链接已失效");
    wrapper.unmount();
  });

  it("会话未确认前不渲染 RouterView：恢复完成前不请求 home", async () => {
    let releaseRestore: () => void = () => undefined;
    const restoreGate = new Promise<void>((resolve) => {
      releaseRestore = resolve;
    });
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/v1/share/session")) {
        await restoreGate;
        return jsonResponse(200, { member: MEMBER });
      }
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, { owned: [], collaborated: [] });
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;

    const { wrapper } = await mountApp("/s/home");
    await nextTick();
    expect(calls.some((url) => url.includes("/api/v1/share/tasks"))).toBe(false);
    expect(wrapper.text()).toContain("正在恢复成员会话");

    releaseRestore();
    await vi.waitFor(() => expect(wrapper.text()).toContain("你好，陈晨"));
    expect(calls.some((url) => url.includes("/api/v1/share/tasks"))).toBe(true);
    wrapper.unmount();
  });
});

describe("MemberHomePage（成员个人页只读）", () => {
  const ownedTask = makeTask({
    id: "t-owned",
    description: "更新登录页",
    folderId: "f-sub",
    importance: "high",
    progress: 60,
    owners: [MEMBER],
    subtasks: [
      { id: "s-1", parentId: "t-owned", description: "拆分子任务", owner: MEMBER, progress: 100, importance: "high", dueDate: null, version: 1 },
    ],
  });
  const collabTask = makeTask({
    id: "t-collab",
    description: "支付回调联调",
    importance: "mid",
    progress: 20,
    owners: [OTHER],
    collaborators: [MEMBER, THIRD],
    detail: "",
  });

  function installHomeFetch(home: { owned: Task[]; collaborated: Task[] }): void {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/share/session")) return jsonResponse(200, { member: MEMBER });
      if (url.includes("/api/v1/share/folders/tree")) return jsonResponse(200, { tree: FOLDER_TREE });
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, home);
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;
  }

  it("两组分组+计数+只读卡：负责人/协作、任务夹路径、协作徽标与零控件", async () => {
    installHomeFetch({ owned: [ownedTask], collaborated: [collabTask] });
    const { wrapper } = await mountApp("/s/home");
    await vi.waitFor(() => expect(wrapper.text()).toContain("更新登录页"));

    expect(wrapper.text()).toContain("你好，陈晨");
    expect(wrapper.text()).toContain("你负责的 1 项 · 你协作的 1 项");

    const groups = wrapper.findAll(".share-group");
    expect(groups).toHaveLength(2);
    expect(groups[0].find(".cnt").text()).toBe("1");
    expect(groups[1].find(".cnt").text()).toBe("1");
    expect(groups[0].text()).toContain("我负责的任务");
    expect(groups[1].text()).toContain("我协作的任务");

    const ownedCard = groups[0].find(".stask");
    expect(ownedCard.exists()).toBe(true);
    expect(ownedCard.text()).toContain("负责人");
    expect(ownedCard.find(".ro-tag").exists()).toBe(false);
    expect(ownedCard.text()).toContain("📁 迭代 / 子夹");
    expect(ownedCard.text()).toContain("重要度 · 高");

    const collabCard = groups[1].find(".stask");
    expect(collabCard.exists()).toBe(true);
    expect(collabCard.text()).toContain("协作任务 · 只读");
    expect(collabCard.find(".ro-tag").text()).toBe("协作任务 · 只读");
    expect(collabCard.text()).toContain("李雷");
    expect(collabCard.text()).toContain("韩梅梅");
    expect(collabCard.text()).toContain("（暂无进展记录）");

    const page = wrapper.find(".share-page");
    expect(page.findAll("input")).toHaveLength(0);
    expect(page.findAll("button")).toHaveLength(0);
    expect(page.text()).not.toContain("保存");
    expect(page.text()).not.toContain("追加");
    expect(page.text()).not.toContain("编辑");
    expect(page.text()).not.toContain("暂无你负责的任务");
    expect(page.text()).not.toContain("暂无你协作的任务");
    wrapper.unmount();
  });

  it("空态：两组各自显示原型文案，计数为 0", async () => {
    installHomeFetch({ owned: [], collaborated: [] });
    const { wrapper } = await mountApp("/s/home");
    await vi.waitFor(() => expect(wrapper.text()).toContain("暂无你负责的任务"));
    expect(wrapper.text()).toContain("暂无你协作的任务");
    expect(wrapper.text()).toContain("你负责的 0 项 · 你协作的 0 项");
    expect(wrapper.find(".share-page").findAll(".stask")).toHaveLength(0);
    wrapper.unmount();
  });

  it("home 查询 401：清理 share 缓存并进入失效页（不停留在错误态）", async () => {
    const queryClient = createAppQueryClient();
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/share/session")) return jsonResponse(200, { member: MEMBER });
      if (url.includes("/api/v1/share/tasks")) {
        return jsonResponse(401, { error: { code: "SHARE_SESSION_REQUIRED", message: "需要成员会话", requestId: "r-2" } });
      }
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;

    const { wrapper, router } = await mountApp("/s/home", queryClient);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/share-invalid"));
    await vi.waitFor(() => expect(wrapper.text()).toContain("链接已失效"));
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ["share"] });
    expect(queryClient.getQueryData(["share", "tasks", "home"])).toBeUndefined();
    wrapper.unmount();
  });

  it("会话恢复 401：直接进入失效页且不渲染成员内容", async () => {
    const queryClient = createAppQueryClient();
    const removeSpy = vi.spyOn(queryClient, "removeQueries");
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/share/session")) {
        return jsonResponse(401, { error: { code: "SHARE_SESSION_REQUIRED", message: "需要成员会话", requestId: "r-3" } });
      }
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;

    const { wrapper, router } = await mountApp("/s/home", queryClient);
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/share-invalid"));
    await vi.waitFor(() => expect(wrapper.text()).toContain("链接已失效"));
    expect(removeSpy).toHaveBeenCalledWith({ queryKey: ["share"] });
    expect(wrapper.find('[aria-label="成员导航"]').exists()).toBe(false);
    wrapper.unmount();
  });
});
