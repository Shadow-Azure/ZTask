// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { Router } from "vue-router";
import App from "../../apps/web/src/App.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import type { Task } from "@ztask/shared";

/**
 * 成员只读事项跟踪（issue #18 / 08 §6.3、02 §5、05 §6.4–6.5/§6.11）：
 * 成员壳内的事项跟踪只允许 `GET /api/v1/share/**`，不渲染任何写入口，
 * 点击任务卡打开只读详情，「加载更多」续页，越权 401 进入失效页。
 * 任何 `/api/v1/admin/` 请求都会被记录并让用例失败。
 */

const TREE = {
  tree: [
    {
      id: "f-1",
      parentId: null,
      name: "迭代",
      position: 0,
      children: [],
      tasks: [],
      counts: { done: 0, todo: 1 },
    },
  ],
};

const TASK_A: Task = {
  id: "t-a",
  folderId: "f-1",
  parentId: null,
  description: "成员可见任务 A",
  owners: [{ id: "m-a", name: "陈晨", role: "", color: "#2f6fe0" }],
  collaborators: [{ id: "m-b", name: "李雷", role: "", color: "#e08a2f" }],
  progress: 40,
  detail: "第一条进展\n第二条进展",
  importance: "high",
  dueDate: "2099-01-01",
  version: 3,
  createdAt: "2026-11-01T01:00:00.000Z",
  updatedAt: "2026-11-01T02:00:00.000Z",
  subtasks: [
    { id: "s-a", parentId: "t-a", description: "小任务一", owner: { id: "m-a", name: "陈晨", role: "", color: "#2f6fe0" }, progress: 100, importance: "mid", dueDate: null, version: 3 },
  ],
};

const TASK_B: Task = {
  ...TASK_A,
  id: "t-b",
  description: "成员可见任务 B（第二页）",
  detail: "第二页任务的进展",
};

const DETAIL_A = { ...TASK_A, memberRole: "owner" as const };

let adminRequests: string[] = [];
let shareRequests: string[] = [];
let mounted: VueWrapper | undefined;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function errorResponse(status: number, code: string): Response {
  return jsonResponse(status, { error: { code, message: "请求失败", requestId: "req-test" } });
}

/**
 * 安装 share 域的 fetch 假实现：`responder` 返回响应体（或直接返回 Response），
 * `/api/v1/admin/**` 一律记为越权并返回 403。
 * @param responder 按 URL 返回响应体；返回 undefined 视为 404。
 */
function mockShareFetch(responder: (url: URL) => unknown): void {
  adminRequests = [];
  shareRequests = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    if (url.pathname.startsWith("/api/v1/admin/")) {
      adminRequests.push(url.pathname);
      return errorResponse(403, "ADMIN_LOCAL_ONLY");
    }
    shareRequests.push(`${url.pathname}${url.search}`);
    const body = responder(url);
    if (body instanceof Response) return body;
    if (body === undefined) return errorResponse(404, "NOT_FOUND");
    return jsonResponse(200, body);
  }) as typeof fetch;
}

/** 默认响应器：会话恢复 + 可见树 + 指定任务页/详情。 */
function defaultResponder(options: {
  tasks: (url: URL) => unknown;
  detail?: unknown;
  tree?: unknown;
}): (url: URL) => unknown {
  return (url) => {
    if (url.pathname === "/api/v1/share/session") {
      return { member: { id: "m-a", name: "陈晨", role: "", color: "#2f6fe0" } };
    }
    if (url.pathname === "/api/v1/share/folders/tree") return options.tree ?? TREE;
    if (url.pathname.startsWith("/api/v1/share/tasks/")) return options.detail ?? DETAIL_A;
    if (url.pathname === "/api/v1/share/tasks") return options.tasks(url);
    return undefined;
  };
}

async function mountTracker(path = "/s/tracker"): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createAppRouter();
  await router.push(path);
  await router.isReady();
  const wrapper = mount(App, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  mounted = wrapper;
  return { wrapper, router };
}

function dialogElement(): HTMLElement {
  return document.body.querySelector('[role="dialog"]') as HTMLElement;
}

function expectNoAdminRequest(): void {
  expect(adminRequests).toEqual([]);
}

beforeEach(() => {
  adminRequests = [];
  shareRequests = [];
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("成员只读事项跟踪（/s/tracker）", () => {
  it("只请求 share API，渲染任务卡且不渲染任何写入口", async () => {
    mockShareFetch(defaultResponder({ tasks: () => ({ items: [TASK_A], nextCursor: null }) }));
    const { wrapper } = await mountTracker();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-task-card="t-a"]').exists()).toBe(true);
    });

    expect(wrapper.text()).toContain("成员可见任务 A");
    expect(wrapper.text()).toContain("只读视图");
    expect(wrapper.text()).toContain("成员视图为只读；点击任务可查看完整详情。");
    expect(wrapper.text()).not.toContain("＋ 新建任务");
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");
    expect(wrapper.findAll('input[type="range"]')).toHaveLength(0);
    const buttonTexts = wrapper.findAll("button").map((button) => button.text());
    expect(buttonTexts.some((text) => text.includes("保存"))).toBe(false);
    expect(buttonTexts.some((text) => text.includes("删除"))).toBe(false);

    expectNoAdminRequest();
    for (const request of shareRequests) {
      expect(request.startsWith("/api/v1/share/")).toBe(true);
    }
    expect(shareRequests.some((request) => request.includes("view=tracker"))).toBe(true);
  });

  it("点击任务卡打开只读详情：字段齐全、无输入、只有关闭按钮", async () => {
    mockShareFetch(defaultResponder({ tasks: () => ({ items: [TASK_A], nextCursor: null }) }));
    const { wrapper } = await mountTracker();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-task-card="t-a"]').exists()).toBe(true);
    });
    await wrapper.find('[data-task-card="t-a"] .card-head').trigger("click");

    await vi.waitFor(() => {
      expect(dialogElement()).toBeTruthy();
    });
    const dialog = dialogElement();
    await vi.waitFor(() => {
      expect(dialog.textContent).toContain("第一条进展");
    });

    expect(dialog.getAttribute("aria-label")).toBe("任务详情（只读）");
    expect(dialog.textContent).toContain("任务描述");
    expect(dialog.textContent).toContain("成员可见任务 A");
    expect(dialog.textContent).toContain("负责人");
    expect(dialog.textContent).toContain("陈晨");
    expect(dialog.textContent).toContain("协作");
    expect(dialog.textContent).toContain("李雷");
    expect(dialog.textContent).toContain("重要度");
    expect(dialog.textContent).toContain("预计完成");
    expect(dialog.textContent).toContain("进度");
    expect(dialog.textContent).toContain("进展详情");
    expect(dialog.textContent).toContain("小任务摘要");
    expect(dialog.textContent).toContain("小任务一");

    // 只读：无任何输入控件，唯一按钮是头部关闭按钮（05 §6.5、08 §6.3）。
    expect(dialog.querySelectorAll("input, textarea, select")).toHaveLength(0);
    const buttons = [...dialog.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("title")).toBe("关闭");
    expect(dialog.textContent).not.toContain("保存");
    expect(dialog.textContent).not.toContain("删除");

    // 关闭：Escape 也可用。
    dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    expectNoAdminRequest();
  });

  it("点击子任务进展 / 进展详情区块打开只读详情", async () => {
    mockShareFetch(defaultResponder({ tasks: () => ({ items: [TASK_A], nextCursor: null }) }));
    const { wrapper, router } = await mountTracker();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-task-card="t-a"]').exists()).toBe(true);
    });

    for (const label of ["子任务进展", "任务进展详情"]) {
      await wrapper.find(`[data-task-card="t-a"] .pane[aria-label="${label}"]`).trigger("click");
      await vi.waitFor(() => {
        expect(dialogElement()).toBeTruthy();
      });
      expect(dialogElement().getAttribute("aria-label")).toBe("任务详情（只读）");
      await vi.waitFor(() => {
        expect(dialogElement().textContent).toContain("第一条进展");
      });
      dialogElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      // 关闭会同步移除 ?task= 深链；等 URL 与浮窗都回落后再点下一个区块，避免两次 replace 交错。
      await vi.waitFor(() => {
        expect(router.currentRoute.value.query.task).toBeUndefined();
      });
      await vi.waitFor(() => {
        expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      });
    }

    expectNoAdminRequest();
  });

  it("小任务详情形态（{task,parent,memberRole}）同样只读且带父任务上下文", async () => {
    const SUBTASK_DETAIL = {
      task: TASK_A.subtasks[0],
      parent: TASK_A,
      memberRole: "collaborator" as const,
    };
    mockShareFetch(
      defaultResponder({
        tasks: () => ({ items: [TASK_A], nextCursor: null }),
        detail: SUBTASK_DETAIL,
      }),
    );
    const { wrapper } = await mountTracker();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-task-card="t-a"]').exists()).toBe(true);
    });
    await wrapper.find('[data-task-card="t-a"] .card-head').trigger("click");

    await vi.waitFor(() => {
      expect(dialogElement()?.textContent).toContain("所属主任务");
    });
    const dialog = dialogElement();
    expect(dialog.textContent).toContain("小任务一");
    expect(dialog.textContent).toContain("成员可见任务 A");
    expect(dialog.textContent).toContain("第一条进展");
    expect(dialog.textContent).toContain("协作");
    expect(dialog.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect([...dialog.querySelectorAll("button")]).toHaveLength(1);
    expectNoAdminRequest();
  });

  it("空列表显示只读空态，不提示新建任务", async () => {
    mockShareFetch(defaultResponder({ tasks: () => ({ items: [], nextCursor: null }) }));
    const { wrapper } = await mountTracker();

    await vi.waitFor(() => {
      expect(wrapper.find(".empty-tip").exists()).toBe(true);
    });
    const empty = wrapper.find(".empty-tip");
    // D18（原型 1196）：空态为纯文本行，成员端说明只读范围。
    expect(empty.text()).toContain("没有与你相关的任务");
    expect(empty.text()).toContain("成员视图为只读");
    expect(empty.text()).not.toContain("新建任务");
    expectNoAdminRequest();
  });

  it("URL 的 folder 不在可见树中时回退到「全部任务夹」（08 §2.1）", async () => {
    mockShareFetch(defaultResponder({ tasks: () => ({ items: [], nextCursor: null }) }));
    const { router } = await mountTracker("/s/tracker?folder=f-missing");

    await vi.waitFor(() => {
      expect(router.currentRoute.value.query.folder).toBeUndefined();
    });
    expect(router.currentRoute.value.path).toBe("/s/tracker");
    expectNoAdminRequest();
  });

  it("nextCursor 非空时「加载更多」追加下一页，末页后按钮消失（05 §6.4）", async () => {
    mockShareFetch(
      defaultResponder({
        tasks: (url) =>
          url.searchParams.get("cursor") === "cursor-2"
            ? { items: [TASK_B], nextCursor: null }
            : { items: [TASK_A], nextCursor: "cursor-2" },
      }),
    );
    const { wrapper } = await mountTracker();

    await vi.waitFor(() => {
      expect(wrapper.find('[data-task-card="t-a"]').exists()).toBe(true);
    });
    const loadMore = wrapper.findAll("button").find((button) => button.text().includes("加载更多"));
    expect(loadMore).toBeTruthy();
    await loadMore!.trigger("click");

    await vi.waitFor(() => {
      expect(wrapper.find('[data-task-card="t-b"]').exists()).toBe(true);
    });
    expect(wrapper.find('[data-task-card="t-a"]').exists()).toBe(true);
    expect(wrapper.findAll("button").some((button) => button.text().includes("加载更多"))).toBe(false);
    expect(shareRequests.some((request) => request.includes("cursor=cursor-2"))).toBe(true);
    expectNoAdminRequest();
  });

  it("share 查询 401 时清理会话并进入失效页（08 §7）", async () => {
    mockShareFetch((url) => {
      if (url.pathname === "/api/v1/share/session") {
        return { member: { id: "m-a", name: "陈晨", role: "", color: "#2f6fe0" } };
      }
      if (url.pathname === "/api/v1/share/folders/tree") return TREE;
      return errorResponse(401, "SHARE_SESSION_REQUIRED");
    });
    const { router } = await mountTracker();

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe("/share-invalid");
    });
    expectNoAdminRequest();
  });

  it("?task= 深链直接打开只读详情，关闭后从 URL 移除（03 §2）", async () => {
    mockShareFetch(defaultResponder({ tasks: () => ({ items: [TASK_A], nextCursor: null }) }));
    const { wrapper, router } = await mountTracker("/s/tracker?task=t-a");

    await vi.waitFor(() => {
      expect(dialogElement()?.textContent).toContain("任务详情（只读）");
    });
    expect(dialogElement()?.textContent).toContain("成员可见任务 A");
    expect(router.currentRoute.value.query.task).toBe("t-a");

    dialogElement().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });
    expect(router.currentRoute.value.query.task).toBeUndefined();
    expectNoAdminRequest();
  });

  it("详情请求 401 时同样清理会话并进入失效页（08 §7）", async () => {
    mockShareFetch(
      defaultResponder({ tasks: () => ({ items: [TASK_A], nextCursor: null }) }),
    );
    // 覆盖详情端点为 401，其余保持正常。
    const baseFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname.startsWith("/api/v1/share/tasks/")) return errorResponse(401, "SHARE_SESSION_REQUIRED");
      return baseFetch(input as RequestInfo, init);
    }) as typeof fetch;

    const { wrapper, router } = await mountTracker();
    await vi.waitFor(() => {
      expect(wrapper.find('[data-task-card="t-a"]').exists()).toBe(true);
    });
    await wrapper.find('[data-task-card="t-a"] .card-head').trigger("click");

    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe("/share-invalid");
    });
    expectNoAdminRequest();
  });

  it("成员域「情况看板」：未选任务夹时提示先选择，不请求成员目录也不暴露内部 issue 文案", async () => {
    mockShareFetch(defaultResponder({ tasks: () => ({ items: [], nextCursor: null }) }));
    const { wrapper } = await mountTracker("/s/tracker?tab=dash");

    await vi.waitFor(() => {
      expect(wrapper.text()).toContain("先选择任务夹");
    });
    expect(wrapper.text()).not.toContain("m5");
    expectNoAdminRequest();
  });
});
