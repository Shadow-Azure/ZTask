// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createAppRouter } from "../../apps/web/src/router";
import FolderTree from "../../apps/web/src/features/folders/FolderTree.vue";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";

const TREE = {
  tree: [
    {
      id: "f1",
      parentId: null,
      name: "客户增量构",
      position: 0,
      children: [{ id: "f2", parentId: "f1", name: "数据平台", position: 0, children: [], tasks: [], counts: { done: 0, todo: 0 } }],
      tasks: [{ id: "t-1", description: "任务树组件重构", progress: 70, importance: "high" }],
      counts: { done: 0, todo: 1 },
    },
  ],
};

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function mockFetch(tree = TREE): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    const url = String(input);
    if (url.includes("/admin/folders/tree")) {
      return new Response(JSON.stringify(tree), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/admin/folders") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "f-new", parentId: null, name: "新夹", position: 1 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

async function mountTree(
  canEdit: boolean,
  extra: { creating?: boolean; createParentId?: string | null } = {},
) {
  const wrapper = mount(FolderTree, {
    props: { canEdit, ...extra },
    global: { plugins: [createAppRouter(), [VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 30));
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await nextTick();
  return wrapper;
}

describe("FolderTree（features/folders）", () => {
  it("渲染服务端树与任务计数（新建入口由树头 TrackerView 承载）", async () => {
    mockFetch();
    const wrapper = await mountTree(true);
    expect(wrapper.text()).toContain("客户增量构");
    expect(wrapper.text()).toContain("数据平台");
    expect(wrapper.text()).toContain("✓0○1");
    wrapper.unmount();
  });

  it("未处于新建态时不渲染树内新建行", async () => {
    mockFetch();
    const wrapper = await mountTree(true);
    expect(wrapper.find(".create-input").exists()).toBe(false);
    wrapper.unmount();
  });

  it("处于新建态时渲染树根新建行并发送 POST（parentId=null）", async () => {
    mockFetch();
    const wrapper = await mountTree(true, { creating: true, createParentId: null });
    await wrapper.find(".create-input").setValue("新夹");
    await wrapper.find(".create-input").trigger("keydown", { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const post = fetchCalls.find((call) => call.init?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post?.init?.body))).toEqual({ name: "新夹", parentId: null });
    wrapper.unmount();
  });

  it("右键任务夹和任务行向上发出菜单目标", async () => {
    mockFetch();
    const wrapper = await mountTree(true);
    await wrapper.find(".row").trigger("contextmenu", { clientX: 120, clientY: 80 });
    await nextTick();
    const folderEvent = wrapper.emitted("context-menu")?.[0]?.[0] as Record<string, unknown>;
    expect(folderEvent).toMatchObject({ kind: "folder", id: "f1", folderId: "f1", name: "客户增量构", x: 120, y: 80 });

    await wrapper.find(".row.task").trigger("contextmenu", { clientX: 140, clientY: 100 });
    await nextTick();
    const taskEvent = wrapper.emitted("context-menu")?.[1]?.[0] as Record<string, unknown>;
    expect(taskEvent).toMatchObject({ kind: "task", id: "t-1", folderId: "f1", name: "任务树组件重构", x: 140, y: 100 });
    wrapper.unmount();
  });
});
