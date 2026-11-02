// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import TrackerView from "../../apps/web/src/features/tracker/TrackerView.vue";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

const TREE = {
  tree: [
    { id: "f-1", parentId: null, name: "迭代", position: 0, children: [], tasks: [], counts: { done: 0, todo: 0 } },
  ],
};

const TASKS = {
  items: [
    {
      id: "t-1", folderId: "f-1", parentId: null, description: "高重要任务",
      owners: [{ id: "m-1", name: "陈晨", role: "", color: "#2f6fe0" }], collaborators: [],
      progress: 30, detail: "d", importance: "high", dueDate: "2099-01-01",
      version: 1, createdAt: "2026-11-01T01:00:00.000Z", updatedAt: "2026-11-01T01:00:00.000Z",
      subtasks: [],
    },
  ],
};

let listCalls: Array<{ url: string }> = [];

function mockFetch(): void {
  listCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/admin/tasks")) listCalls.push({ url });
    if (url.includes("/admin/folders/tree")) {
      return new Response(JSON.stringify(TREE), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/admin/members")) {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(TASKS), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function mountView(query: Record<string, string> = {}) {
  const router = createAppRouter();
  await router.push({ path: "/tracker", query });
  await router.isReady();
  const wrapper = mount(TrackerView, {
    props: { access: "admin" },
    global: { plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 40));
  await nextTick();
  return { wrapper, router };
}

describe("TrackerView（事项跟踪体验）", () => {
  it("服务端筛选：重要度 chip 触发带 importance 参数的列表查询", async () => {
    mockFetch();
    const { wrapper } = await mountView({ folder: "f-1" });
    const chips = wrapper.findAll(".fchip");
    await chips[1]!.trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 40));
    const withParam = listCalls.find((call) => call.url.includes("importance=high"));
    expect(withParam).toBeTruthy();
    wrapper.unmount();
  });

  it("搜索防抖后触发带 q 参数的服务端查询", async () => {
    mockFetch();
    const { wrapper } = await mountView({ folder: "f-1" });
    vi.useFakeTimers();
    try {
      const before = listCalls.length;
      await wrapper.find(".search-box").setValue("虚拟滚动");
      await vi.advanceTimersByTimeAsync(400);
      const withQ = listCalls.find((call) => call.url.includes("q="));
      expect(withQ).toBeTruthy();
      expect(listCalls.length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
      wrapper.unmount();
    }
  });

  it("卡片点击打开编辑浮窗（编辑仅经明确入口）", async () => {
    mockFetch();
    const { wrapper } = await mountView({ folder: "f-1" });
    expect(wrapper.find(".task-list .task-card").exists()).toBe(true);
    await wrapper.find(".task-card .card-head").trigger("click");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await nextTick();
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
    wrapper.unmount();
  });

  it("树拖柄指针拖拽映射为树宽（钳制 220–480）", async () => {
    mockFetch();
    const { wrapper } = await mountView({ folder: "f-1" });
    const resizer = wrapper.find('[role="separator"]');
    resizer.element.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, button: 0, bubbles: true }));
    resizer.element.dispatchEvent(new PointerEvent("pointermove", { clientX: 520, bubbles: true }));
    await nextTick();
    const treeSide = wrapper.find(".tree-side");
    const width = Number((treeSide.attributes("style") ?? "").match(/width: (\d+)px/)?.[1] ?? 0);
    expect(width).toBe(480);
    wrapper.unmount();
  });

  it("刷新恢复：folder 深链直接命中树选中态", async () => {
    mockFetch();
    const { wrapper } = await mountView({ folder: "f-1" });
    const selected = wrapper.find(".tree-node .row.selected");
    expect(selected.exists()).toBe(true);
    expect(selected.text()).toContain("迭代");
    wrapper.unmount();
  });
});
