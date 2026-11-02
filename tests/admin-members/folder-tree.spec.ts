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

async function mountTree(canEdit: boolean) {
  const wrapper = mount(FolderTree, {
    props: { canEdit },
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
  it("渲染服务端树与任务计数；管理员可见新建入口", async () => {
    mockFetch();
    const wrapper = await mountTree(true);
    expect(wrapper.text()).toContain("客户增量构");
    expect(wrapper.text()).toContain("数据平台");
    expect(wrapper.text()).toContain("0/1");
    expect(wrapper.text()).toContain("＋ 新建任务夹");
    wrapper.unmount();
  });

  it("非管理员不渲染新建入口", async () => {
    mockFetch();
    const wrapper = await mountTree(false);
    expect(wrapper.text()).not.toContain("＋ 新建任务夹");
    wrapper.unmount();
  });

  it("创建任务夹发送 POST（parentId 取当前选中/根）并失效树查询", async () => {
    mockFetch();
    const wrapper = await mountTree(true);
    await wrapper.find(".create-btn").trigger("click");
    await wrapper.find(".create-input").setValue("新夹");
    await wrapper.find(".create-input").trigger("keydown", { key: "Enter" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const post = fetchCalls.find((call) => call.init?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(String(post?.init?.body))).toEqual({ name: "新夹", parentId: null });
    wrapper.unmount();
  });
});
