// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import type { AdminMember, FolderTreeNode, Task } from "@ztask/shared";
import TrackerPage from "../../apps/web/src/pages/TrackerPage.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

async function mountTracker(props: { access?: "admin" | "readonly" }, query: Record<string, string> = {}) {
  const router = createAppRouter();
  await router.push({ path: "/tracker", query });
  await router.isReady();
  const wrapper = mount(TrackerPage, {
    props,
    global: {
      plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]],
    },
  });
  await nextTick();
  return { wrapper, router };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const ADMIN_TREE: { tree: FolderTreeNode[] } = {
  tree: [
    {
      id: "f-admin",
      parentId: null,
      name: "迭代",
      position: 0,
      tasks: [{ id: "t-admin-1", description: "管理端任务一", progress: 30, importance: "high" }],
      counts: { done: 0, todo: 2 },
      children: [],
    },
  ],
};

const ADMIN_MEMBER: AdminMember = {
  id: "m-admin",
  name: "陈晨",
  role: "前端",
  color: "#2f6fe0",
  archivedAt: null,
  counts: { owned: 2, collaborated: 0 },
  shareLink: null,
};

function adminTask(id: string, description: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    folderId: "f-admin",
    parentId: null,
    description,
    owners: [ADMIN_MEMBER],
    collaborators: [],
    progress: 30,
    detail: `${description}的进展`,
    importance: "high",
    dueDate: "2099-01-01",
    version: 1,
    createdAt: "2026-11-01T01:00:00.000Z",
    updatedAt: "2026-11-01T01:00:00.000Z",
    subtasks: [],
    ...overrides,
  };
}

const ADMIN_TASKS: Task[] = [adminTask("t-admin-1", "管理端任务一"), adminTask("t-admin-2", "管理端任务二", { importance: "low" })];

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("TrackerPage 结构与权限体验", () => {
  it("admin：树侧 + 拖柄 + 面板齐备，含新建控件与真实任务夹树", async () => {
    const { wrapper } = await mountTracker({ access: "admin" });
    expect(wrapper.find(".tree-side").exists()).toBe(true);
    expect(wrapper.find(".folder-tree").exists()).toBe(true);
    expect(wrapper.find('[role="separator"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("＋ 新建任务夹");
    expect(wrapper.text()).toContain("＋ 新建任务");
  });

  it("tab 深链：?tab=dash 切到看板占位", async () => {
    const { wrapper } = await mountTracker({ access: "admin" }, { tab: "dash" });
    expect(wrapper.text()).toContain("情况看板统计与历史变化将在 m5 接入");
    expect(wrapper.find('[role="tab"][aria-selected="true"]').text()).toBe("情况看板");
    wrapper.unmount();
  });

  it("只读模式：无新建控件且显示只读标识", async () => {
    const { wrapper } = await mountTracker({ access: "readonly" });
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");
    expect(wrapper.text()).not.toContain("＋ 新建任务");
    expect(wrapper.text()).toContain("只读视图");
  });

  it("树宽偏好持久化进 localStorage（仅布局键）", async () => {
    localStorage.clear();
    const { wrapper } = await mountTracker({ access: "admin" });
    const resizer = wrapper.find('[role="separator"]');
    await resizer.trigger("keydown", { key: "ArrowRight" });
    await nextTick();
    const stored = localStorage.getItem("ztask:pref:treeWidth");
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThanOrEqual(220);
    wrapper.unmount();
  });

  it("admin 带数据：累积任务卡渲染、点击打开编辑器浮窗，且不请求任何 share API", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), window.location.origin);
      calls.push(`${url.pathname}${url.search}`);
      if (url.pathname === "/api/v1/admin/folders/tree") return jsonResponse(200, ADMIN_TREE);
      if (url.pathname === "/api/v1/admin/tasks") return jsonResponse(200, { items: ADMIN_TASKS, nextCursor: null });
      if (url.pathname === "/api/v1/admin/members") return jsonResponse(200, { items: [ADMIN_MEMBER] });
      return jsonResponse(404, { error: { code: "NOT_FOUND", message: "未找到", requestId: "r-test" } });
    }) as typeof fetch;

    const { wrapper } = await mountTracker({ access: "admin" }, { folder: "f-admin" });

    // admin 的 tasks 列表走 accumulated（第一页累积）：两条任务卡都渲染。
    await vi.waitFor(() => expect(wrapper.find('[data-task-card="t-admin-1"]').exists()).toBe(true));
    expect(wrapper.find('[data-task-card="t-admin-2"]').exists()).toBe(true);
    expect(wrapper.findAll(".task-card")).toHaveLength(2);
    expect(wrapper.text()).toContain("管理端任务一");
    expect(wrapper.text()).toContain("管理端任务二");

    // 点击任务卡打开编辑器浮窗（TaskEditorDialog 由 v-if="isAdmin" 渲染）。
    await wrapper.find('[data-task-card="t-admin-1"] .card-head').trigger("click");
    await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')).toBeTruthy());
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute("aria-label")).toBe("任务详情");
    const descriptionInput = dialog.querySelector('input[aria-label="任务描述"]') as HTMLInputElement;
    expect(descriptionInput.value).toBe("管理端任务一");
    expect(dialog.textContent).toContain("陈晨");

    // 管理端数据路径：只走 /admin/**，绝不发 share 请求。
    expect(calls.some((entry) => entry.startsWith("/api/v1/share/"))).toBe(false);
    expect(calls.some((entry) => entry.startsWith("/api/v1/admin/tasks?") && entry.includes("folderId=f-admin"))).toBe(true);
    wrapper.unmount();
  });
});
