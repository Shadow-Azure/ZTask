// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import TaskEditorDialog from "../../apps/web/src/features/tasks/TaskEditorDialog.vue";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import type { Task } from "@ztask/shared";

const MEMBERS = [
  { id: "m-1", name: "陈晨", role: "前端", color: "#2f6fe0", archivedAt: null, counts: { owned: 0, collaborated: 0 }, shareLink: null },
  { id: "m-2", name: "林悦", role: "后端", color: "#1f9d6b", archivedAt: null, counts: { owned: 0, collaborated: 0 }, shareLink: null },
];

function taskFixture(): Task {
  return {
    id: "t-1",
    folderId: "f-1",
    parentId: null,
    description: "任务树组件重构",
    owners: [{ id: "m-1", name: "陈晨", role: "前端", color: "#2f6fe0" }],
    collaborators: [],
    progress: 40,
    detail: "当前详情",
    plan: "当前方案",
    importance: "high",
    dueDate: "2026-11-10",
    version: 3,
    createdAt: "2026-11-01T01:00:00.000Z",
    updatedAt: "2026-11-01T02:00:00.000Z",
    subtasks: [
      { id: "s-1", parentId: "t-1", description: "已有小任务", owner: { id: "m-1", name: "陈晨", role: "前端", color: "#2f6fe0" }, progress: 50, importance: "mid", dueDate: null, version: 3 },
    ],
  };
}

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];

function mockFetch(response: { status: number; body?: unknown }): void {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), init });
    if (response.status === 409) {
      return new Response(JSON.stringify({ error: { code: "TASK_VERSION_CONFLICT", message: "任务已被其他人更新", requestId: "r-1" } }), {
        status: 409,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(response.body ?? {}), { status: response.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

async function mountEditor(task: Task | null) {
  const wrapper = mount(TaskEditorDialog, {
    props: { open: true, folderId: "f-1", task, members: MEMBERS, folders: [] },
    global: { plugins: [[VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  await nextTick();
  return wrapper;
}

function dialog(): HTMLElement {
  return document.body.querySelectorAll('[role="dialog"]')[0] as HTMLElement;
}

function clickByText(container: HTMLElement, text: string, selector = "button"): void {
  const button = [...container.querySelectorAll(selector)].find((el) => el.textContent?.includes(text));
  if (!button) throw new Error(`button ${text} not found`);
  (button as HTMLButtonElement).click();
}

async function setInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await nextTick();
}

describe("TaskEditorDialog（08 §3 编辑器）", () => {
  it("编辑模式：草稿字段来自任务；保存发送 PUT（含 update 小任务与 version）", async () => {
    mockFetch({ status: 200, body: taskFixture() });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    expect((root.querySelector(".desc-input") as HTMLInputElement).value).toBe("任务树组件重构");

    await setInput(root.querySelector(".desc-input") as HTMLInputElement, "编辑后标题");
    clickByText(root, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));

    const put = fetchCalls.find((call) => call.init?.method === "PUT");
    expect(put?.url).toContain("/admin/tasks/t-1/editor");
    const body = JSON.parse(String(put?.init?.body));
    expect(body.version).toBe(3);
    expect(body.task.description).toBe("编辑后标题");
    expect(body.task.ownerIds).toEqual(["m-1"]);
    expect(body.subtasks.update[0].id).toBe("s-1");
    wrapper.unmount();
  });

  it("空描述在字段旁报错且不发送请求", async () => {
    mockFetch({ status: 200, body: taskFixture() });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    await setInput(root.querySelector(".desc-input") as HTMLInputElement, "");
    clickByText(root, "保存");
    await nextTick();
    expect(root.textContent).toContain("任务描述不能为空");
    expect(fetchCalls.find((call) => call.init?.method === "PUT")).toBeUndefined();
    wrapper.unmount();
  });

  it("新增小任务以 clientId 进入 create 数组", async () => {
    mockFetch({ status: 200, body: taskFixture() });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    // D11 后小任务行由行内输入直接创建：填写描述后回车，进入 create 数组。
    const addInput = root.querySelector('[aria-label="新小任务描述"]') as HTMLInputElement;
    await setInput(addInput, "新小任务");
    addInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    clickByText(root, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const body = JSON.parse(String(fetchCalls.find((call) => call.init?.method === "PUT")?.init?.body));
    expect(body.subtasks.create.length).toBe(1);
    expect(body.subtasks.create[0].description).toBe("新小任务");
    expect(body.subtasks.create[0].clientId).toMatch(/^client-/);
    wrapper.unmount();
  });

  it("新建模式：小任务草稿进入 POST create 意图，而不是被静默丢弃", async () => {
    mockFetch({ status: 201, body: taskFixture() });
    const wrapper = await mountEditor(null);
    const root = dialog();
    await setInput(root.querySelector(".desc-input") as HTMLInputElement, "新主任务");
    (root.querySelector('[aria-label="负责人"]') as HTMLElement).click();
    await nextTick();
    const ownerOption = [...document.body.querySelectorAll('[role="option"]')].find((el) => el.textContent?.includes("陈晨")) as HTMLElement;
    ownerOption.click();
    (root.querySelector(".desc-input") as HTMLElement).click();
    await nextTick();
    clickByText(root, "高");
    const addInput = root.querySelector('[aria-label="新小任务描述"]') as HTMLInputElement;
    await setInput(addInput, "首版小任务");
    addInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    clickByText(root, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));

    const post = fetchCalls.find((call) => call.init?.method === "POST");
    expect(post?.url).toContain("/admin/tasks");
    const body = JSON.parse(String(post?.init?.body));
    expect(body.description).toBe("新主任务");
    expect(body.subtasks.create).toHaveLength(1);
    expect(body.subtasks.create[0].description).toBe("首版小任务");
    expect(body.subtasks.create[0].ownerId).toBe("m-1");
    expect(body.subtasks.create[0].clientId).toMatch(/^client-/);
    wrapper.unmount();
  });

  it("小任务缺少负责人：就地提示且不发送保存请求", async () => {
    mockFetch({ status: 200, body: taskFixture() });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    const addInput = root.querySelector('[aria-label="新小任务描述"]') as HTMLInputElement;
    await setInput(addInput, "没有负责人的小任务");
    addInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    const ownerSelect = root.querySelector('[aria-label="小任务 2 负责人"]') as HTMLSelectElement;
    ownerSelect.value = "";
    ownerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    clickByText(root, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(root.textContent).toContain("还没有负责人");
    expect(fetchCalls.find((call) => call.init?.method === "PUT")).toBeUndefined();
    wrapper.unmount();
  });

  it("小任务描述为空：就地提示且不发送保存请求", async () => {
    mockFetch({ status: 200, body: taskFixture() });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    const addInput = root.querySelector('[aria-label="新小任务描述"]') as HTMLInputElement;
    await setInput(addInput, "  临时小任务");
    addInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await nextTick();
    await setInput(root.querySelector('[aria-label="小任务 2 描述"]') as HTMLInputElement, "");
    clickByText(root, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(root.textContent).toContain("第 2 行描述不能为空");
    expect(fetchCalls.find((call) => call.init?.method === "PUT")).toBeUndefined();
    wrapper.unmount();
  });

  it("409：保留草稿、显示冲突提示与重试入口，不发新请求即不清空", async () => {
    mockFetch({ status: 409 });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    await setInput(root.querySelector(".desc-input") as HTMLInputElement, "我的草稿标题");
    clickByText(root, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(root.textContent).toContain("服务器已有新版本");
    expect(root.textContent).toContain("基于最新版本重试");
    expect((root.querySelector(".desc-input") as HTMLInputElement).value).toBe("我的草稿标题");
    const puts = fetchCalls.filter((call) => call.init?.method === "PUT");
    expect(puts.length).toBe(1);
    wrapper.unmount();
  });

  it("方案描述（m18-01）：草稿回填、随 PUT 保存；可留空不阻断", async () => {
    mockFetch({ status: 200, body: taskFixture() });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    const planInput = root.querySelector('[aria-label="方案描述"]') as HTMLTextAreaElement;
    expect(planInput.value).toBe("当前方案");
    expect(root.textContent).toContain("方案描述");
    expect(root.textContent).toContain("选填：记录实现思路、技术选型与拆解方案");

    await setInput(planInput, "先抽离树节点渲染为纯组件，再接入虚拟滚动");
    clickByText(root, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const body = JSON.parse(String(fetchCalls.find((call) => call.init?.method === "PUT")?.init?.body));
    expect(body.task.plan).toBe("先抽离树节点渲染为纯组件，再接入虚拟滚动");
    wrapper.unmount();

    // 留空方案同样可保存（选填，不阻断）。
    const empty = taskFixture();
    empty.plan = "";
    mockFetch({ status: 200, body: empty });
    const wrapper2 = await mountEditor(empty);
    const root2 = dialog();
    clickByText(root2, "保存");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const body2 = JSON.parse(String(fetchCalls.find((call) => call.init?.method === "PUT")?.init?.body));
    expect(body2.task.plan).toBe("");
    wrapper2.unmount();
  });

  it("删除：确认后发送 DELETE", async () => {
    mockFetch({ status: 200, body: {} });
    const wrapper = await mountEditor(taskFixture());
    const root = dialog();
    clickByText(root, "删除任务");
    await nextTick();
    const dialogs = document.body.querySelectorAll('[role="dialog"]');
    const confirmDialog = dialogs[dialogs.length - 1] as HTMLElement;
    expect(confirmDialog.textContent).toContain("软删除");
    clickByText(confirmDialog, "确认删除");
    await new Promise((resolve) => setTimeout(resolve, 30));
    const removed = fetchCalls.find((call) => call.init?.method === "DELETE");
    expect(removed?.url).toContain("/admin/tasks/t-1?version=3");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(wrapper.emitted("close")).toBeTruthy();
    expect(document.body.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.body.textContent).not.toContain("删除任务将同时软删除");
    expect(document.body.textContent).not.toContain("确认删除");
    wrapper.unmount();
  });
});
