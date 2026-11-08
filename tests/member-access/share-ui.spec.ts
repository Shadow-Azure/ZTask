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
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, { owned: [], collaborated: [], others: [] });
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
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, { owned: [], collaborated: [], others: [] });
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

  it("恢复瞬时失败（500）：壳内显示可重试错误、不进入失效页；重试成功后渲染成员内容", async () => {
    let restoreCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/share/session")) {
        restoreCalls += 1;
        if (restoreCalls === 1) {
          return jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "服务暂不可用", requestId: "r-6" } });
        }
        return jsonResponse(200, { member: MEMBER });
      }
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, { owned: [], collaborated: [], others: [] });
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;

    const { wrapper, router } = await mountApp("/s/home");
    await vi.waitFor(() => expect(wrapper.text()).toContain("无法连接 ZTask 服务"));
    expect(router.currentRoute.value.path).toBe("/s/home");
    expect(wrapper.text()).not.toContain("链接已失效");
    // 会话未确认：导航与成员内容都不渲染，home 查询也还没发。
    expect(wrapper.find('[aria-label="成员导航"]').exists()).toBe(false);
    expect(wrapper.find(".share-user").exists()).toBe(false);

    const retry = wrapper.findAll("button").find((button) => button.text() === "重试");
    expect(retry).toBeTruthy();
    await retry!.trigger("click");

    await vi.waitFor(() => expect(wrapper.text()).toContain("你好，陈晨"));
    expect(restoreCalls).toBe(2);
    expect(router.currentRoute.value.path).toBe("/s/home");
    expect(wrapper.find('[aria-label="成员导航"]').exists()).toBe(true);
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
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, { owned: [], collaborated: [], others: [] });
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
  const othersTask = makeTask({
    id: "t-others",
    description: "其他成员的任务",
    importance: "low",
    progress: 45,
    owners: [OTHER],
    collaborators: [THIRD],
    detail: "同事的进展",
  });

  function installHomeFetch(home: { owned: Task[]; collaborated: Task[]; others: Task[] }): void {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/share/session")) return jsonResponse(200, { member: MEMBER });
      if (url.includes("/api/v1/share/folders/tree")) return jsonResponse(200, { tree: FOLDER_TREE });
      if (url.includes("/api/v1/share/tasks")) return jsonResponse(200, home);
      return jsonResponse(200, emptyTree());
    }) as typeof fetch;
  }

  it("三组分组+计数：默认展开，标题可折叠/展开；负责人卡可编辑，另两组零控件", async () => {
    installHomeFetch({ owned: [ownedTask], collaborated: [collabTask], others: [othersTask] });
    const { wrapper } = await mountApp("/s/home");
    await vi.waitFor(() => expect(wrapper.text()).toContain("更新登录页"));

    expect(wrapper.text()).toContain("你好，陈晨");
    expect(wrapper.text()).toContain("此链接展示与管理员相同的团队全部事项（共 3 项）：你负责的 1 项可更新，其余 2 项只读。");

    const groups = wrapper.findAll(".share-group");
    expect(groups).toHaveLength(3);
    expect(groups[0].find(".cnt").text()).toBe("1");
    expect(groups[1].find(".cnt").text()).toBe("1");
    expect(groups[2].find(".cnt").text()).toBe("1");
    expect(groups[0].text()).toContain("我负责的任务");
    expect(groups[1].text()).toContain("我协作的任务");
    expect(groups[2].text()).toContain("其他成员的任务");

    // 默认全部展开。
    for (const group of groups) {
      expect(group.find(".group-body").isVisible()).toBe(true);
      expect(group.find(".group-toggle").attributes("aria-expanded")).toBe("true");
    }

    const ownedCard = groups[0].find(".stask");
    expect(ownedCard.exists()).toBe(true);
    expect(ownedCard.text()).toContain("负责人");
    expect(ownedCard.find(".ro-tag").exists()).toBe(false);
    expect(ownedCard.text()).toContain("📁 迭代 / 子夹");
    expect(ownedCard.text()).toContain("重要度 · 高");
    expect(ownedCard.find("input[type='range']").exists()).toBe(true);
    expect(ownedCard.find("textarea").exists()).toBe(true);
    expect(ownedCard.text()).toContain("保存进度");
    expect(ownedCard.text()).toContain("保存详情");
    expect(ownedCard.text()).toContain("添加小任务");
    expect(ownedCard.text()).not.toContain("删除任务");

    const collabCard = groups[1].find(".stask");
    expect(collabCard.exists()).toBe(true);
    expect(collabCard.text()).toContain("协作任务 · 只读");
    expect(collabCard.find(".ro-tag").text()).toBe("协作任务 · 只读");
    const avaTitles = collabCard.findAll(".ava").map((item) => item.attributes("title") ?? "");
    expect(avaTitles.some((title) => title.includes("李雷"))).toBe(true);
    expect(avaTitles.some((title) => title.includes("韩梅梅"))).toBe(true);
    expect(collabCard.text()).toContain("（暂无进展记录）");
    expect(collabCard.findAll("input")).toHaveLength(0);
    expect(collabCard.findAll("button")).toHaveLength(0);
    expect(collabCard.text()).not.toContain("保存");

    const othersCard = groups[2].find(".stask");
    expect(othersCard.exists()).toBe(true);
    expect(othersCard.find(".ro-tag").text()).toBe("其他成员 · 只读");
    expect(othersCard.text()).toContain("同事的进展");
    expect(othersCard.findAll("input")).toHaveLength(0);
    expect(othersCard.findAll("button")).toHaveLength(0);

    // 点击标题折叠第一组，再点展开；aria-expanded 同步。
    const ownedToggle = groups[0].find(".group-toggle");
    await ownedToggle.trigger("click");
    expect(groups[0].classes()).toContain("collapsed");
    expect(groups[0].find(".group-body").isVisible()).toBe(false);
    expect(ownedToggle.attributes("aria-expanded")).toBe("false");
    await ownedToggle.trigger("click");
    expect(groups[0].classes()).not.toContain("collapsed");
    expect(groups[0].find(".group-body").isVisible()).toBe(true);
    expect(ownedToggle.attributes("aria-expanded")).toBe("true");

    expect(wrapper.text()).not.toContain("暂无你负责的任务");
    expect(wrapper.text()).not.toContain("暂无你协作的任务");
    expect(wrapper.text()).not.toContain("暂无其他成员的任务");

    expect(wrapper.findAll(".share-page select")).toHaveLength(0);
    expect(wrapper.findAll(".share-page input[type='date']")).toHaveLength(0);
    expect(wrapper.text()).not.toContain("分配");
    expect(wrapper.text()).not.toContain("删除任务");
    wrapper.unmount();
  });

  it("空态：三组各自显示原型文案，计数为 0", async () => {
    installHomeFetch({ owned: [], collaborated: [], others: [] });
    const { wrapper } = await mountApp("/s/home");
    await vi.waitFor(() => expect(wrapper.text()).toContain("暂无你负责的任务"));
    expect(wrapper.text()).toContain("暂无你协作的任务");
    expect(wrapper.text()).toContain("暂无其他成员的任务");
    expect(wrapper.text()).toContain("共 0 项");
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

describe("成员只读事项跟踪（续页失败）", () => {
  it("续页 400：保留已加载内容、显示「加载更多失败」并可重试，不跳失效页（§6.2）", async () => {
    const pageTask = makeTask({ id: "t-page-1", description: "第一页任务" });
    const cursorRequests: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/v1/share/session") return jsonResponse(200, { member: MEMBER });
      if (url.pathname === "/api/v1/share/folders/tree") return jsonResponse(200, { tree: FOLDER_TREE });
      if (url.pathname === "/api/v1/share/tasks") {
        const cursor = url.searchParams.get("cursor");
        if (cursor === null) return jsonResponse(200, { items: [pageTask], nextCursor: "cursor-stale" });
        cursorRequests.push(cursor);
        return jsonResponse(400, { error: { code: "INVALID_REQUEST", message: "cursor 非法", requestId: "r-7" } });
      }
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "未找到", requestId: "r-7" } });
    }) as typeof fetch;

    const { wrapper, router } = await mountApp("/s/tracker");
    await vi.waitFor(() => expect(wrapper.find('[data-task-card="t-page-1"]').exists()).toBe(true));

    const loadMore = wrapper.findAll("button").find((button) => button.text().includes("加载更多"));
    expect(loadMore).toBeTruthy();
    await loadMore!.trigger("click");

    // 续页失败不再静默：列表保留，紧跟「加载更多」给出可见错误与重试。
    await vi.waitFor(() => expect(wrapper.text()).toContain("加载更多失败"));
    expect(wrapper.find('[data-task-card="t-page-1"]').exists()).toBe(true);
    expect(router.currentRoute.value.path).toBe("/s/tracker");
    expect(wrapper.text()).not.toContain("链接已失效");
    expect(cursorRequests).toEqual(["cursor-stale"]);

    // 重试即重新触发当前 cursor 查询（不清空已加载的第一页）。
    const retry = wrapper.findAll("button").find((button) => button.text() === "重试");
    expect(retry).toBeTruthy();
    await retry!.trigger("click");
    await vi.waitFor(() => expect(cursorRequests).toHaveLength(2));
    // 再次失败后仍保留第一页并继续给出可见错误（重试期间的加载态是既有行为）。
    await vi.waitFor(() => expect(wrapper.find('[data-task-card="t-page-1"]').exists()).toBe(true));
    expect(wrapper.text()).toContain("加载更多失败");
    expect(cursorRequests).toEqual(["cursor-stale", "cursor-stale"]);
    expect(router.currentRoute.value.path).toBe("/s/tracker");
    wrapper.unmount();
  });
});
