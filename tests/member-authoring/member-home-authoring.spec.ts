// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import App from "../../apps/web/src/App.vue";
import { clearToasts } from "../../apps/web/src/components/ui/toast";
import type { FolderTreeNode, MemberSummary, ShareHomeTasks, Task } from "@ztask/shared";

/**
 * 成员个人页 owner 写入与协作者只读（08 §6.2、02 §4.2–4.3）：
 * - 「我负责的」卡有进度/详情/小任务控件，「我协作的」卡没有；
 * - 所有写请求携带聚合 version，成功刷新 share 缓存；
 * - 409 保留草稿并提示刷新。
 */

const MEMBER: MemberSummary = { id: "m-a", name: "陈晨", role: "前端", color: "#2f6fe0" };
const OTHER: MemberSummary = { id: "m-b", name: "林悦", role: "后端", color: "#d97b1c" };

interface Call {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  query: string;
}

const originalFetch = globalThis.fetch;
let calls: Call[];
let home: ShareHomeTasks;
let forcedConflict: boolean;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function tree(): { tree: FolderTreeNode[] } {
  return {
    tree: [
      {
        id: "f-root",
        parentId: null,
        name: "迭代",
        position: 0,
        tasks: [],
        counts: { done: 0, todo: 0 },
        children: [],
      },
    ],
  };
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

function ownedTask(): Task {
  return home.owned[0]!;
}

/** 用请求体更新任务并递增版本，模拟服务端写入后的最新聚合。 */
function applyMutation(body: Record<string, unknown>): Task {
  const task = ownedTask();
  const next: Task = {
    ...task,
    progress: typeof body.progress === "number" ? body.progress : task.progress,
    detail: typeof body.detail === "string" ? body.detail : task.detail,
    version: task.version + 1,
  };
  home = { ...home, owned: [next, ...home.owned.slice(1)] };
  return next;
}

function installServer(): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ method, path: url.pathname, body, query: url.search });

    if (url.pathname === "/api/v1/share/session" && method === "GET") {
      return jsonResponse(200, { member: MEMBER });
    }
    if (url.pathname === "/api/v1/share/tasks" && method === "GET") {
      return jsonResponse(200, home);
    }
    if (url.pathname === "/api/v1/share/folders/tree") {
      return jsonResponse(200, tree());
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/progress" && method === "PATCH") {
      if (forcedConflict) {
        return jsonResponse(409, {
          error: { code: "TASK_VERSION_CONFLICT", message: "任务已被其他人更新", requestId: "r-conflict" },
        });
      }
      const task = applyMutation(body ?? {});
      return jsonResponse(200, { task, revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: "progress" } });
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/detail" && method === "PATCH") {
      const task = applyMutation(body ?? {});
      return jsonResponse(200, { task, revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: "detail" } });
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/subtasks" && method === "POST") {
      const task = applyMutation({
        ...body,
      });
      const subtask = {
        id: "sub-new",
        parentId: task.id,
        description: String(body?.description ?? ""),
        owner: MEMBER,
        progress: Number(body?.progress ?? 0),
        importance: "mid" as const,
        dueDate: null,
        version: task.version,
      };
      home = { ...home, owned: [{ ...task, subtasks: [...task.subtasks, subtask] }, ...home.owned.slice(1)] };
      return jsonResponse(201, { task: ownedTask(), revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: "subtask" } });
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/subtasks/sub-1" && method === "PATCH") {
      const task = applyMutation(body ?? {});
      const subtasks = task.subtasks.map((sub) =>
        sub.id === "sub-1" ? { ...sub, description: String(body?.description ?? sub.description) } : sub,
      );
      home = { ...home, owned: [{ ...task, subtasks }, ...home.owned.slice(1)] };
      return jsonResponse(200, { task: ownedTask(), revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: "subtask" } });
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/subtasks/sub-1" && method === "DELETE") {
      const task = applyMutation({});
      home = { ...home, owned: [{ ...task, subtasks: task.subtasks.filter((sub) => sub.id !== "sub-1") }, ...home.owned.slice(1)] };
      return jsonResponse(200, { task: ownedTask(), revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: "subtask" } });
    }
    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "未知端点", requestId: "r-x" } });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  forcedConflict = false;
  clearToasts();
  home = {
    owned: [
      makeTask({
        id: "t-owner",
        description: "我负责的任务",
        subtasks: [
          {
            id: "sub-1",
            parentId: "t-owner",
            description: "已有小任务",
            owner: MEMBER,
            progress: 20,
            importance: "mid",
            dueDate: null,
            version: 1,
          },
        ],
      }),
    ],
    collaborated: [makeTask({ id: "t-collab", description: "我协作的任务", owners: [OTHER], collaborators: [MEMBER] })],
  };
  localStorage.clear();
  installServer();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  document.body.innerHTML = "";
  clearToasts();
  vi.restoreAllMocks();
});

async function mountHome() {
  const router = createAppRouter();
  await router.push("/s/home");
  await router.isReady();
  const wrapper = mount(App, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    attachTo: document.body,
  });
  await nextTick();
  return { wrapper, router };
}

function card(wrapper: Awaited<ReturnType<typeof mountHome>>["wrapper"], index: number) {
  return wrapper.findAll(".stask")[index]!;
}

describe("成员个人页 owner 写入（08 §6.2）", () => {
  it("owner 卡有进度/详情/小任务控件；collaborator 卡保持只读", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    expect(ownerCard.text()).toContain("保存进度");
    expect(ownerCard.text()).toContain("保存详情");
    expect(ownerCard.text()).toContain("添加小任务");
    expect(ownerCard.find("input[type='range']").exists()).toBe(true);
    expect(ownerCard.find("textarea").exists()).toBe(true);

    const collabCard = card(wrapper, 1);
    expect(collabCard.text()).toContain("协作任务 · 只读");
    expect(collabCard.find("input").exists()).toBe(false);
    expect(collabCard.find("textarea").exists()).toBe(false);
    expect(collabCard.find("button").exists()).toBe(false);
    wrapper.unmount();
  });

  it("保存进度：只提交草稿，请求携带 version，成功后刷新", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.find("input[type='range']").setValue(65);
    const saveButton = ownerCard.findAll("button").find((button) => button.text() === "保存进度")!;
    expect(saveButton.attributes("disabled")).toBeUndefined();
    await saveButton.trigger("click");

    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/progress"));
      expect(patch?.body).toEqual({ progress: 65, version: 1 });
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("进度已保存"));
    wrapper.unmount();
  });

  it("保存详情：全量替换并携带 version", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.find("textarea").setValue("完整替换后的进展详情");
    const saveButton = ownerCard.findAll("button").find((button) => button.text() === "保存详情")!;
    await saveButton.trigger("click");

    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/detail"));
      expect(patch?.body).toEqual({ detail: "完整替换后的进展详情", version: 1 });
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("进展详情已保存"));
    wrapper.unmount();
  });

  it("新建小任务：默认当前成员 owner，提交 description/progress/importance/dueDate", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.findAll("button").find((button) => button.text() === "＋ 添加小任务")!.trigger("click");
    await nextTick();
    await ownerCard.find(".sub-desc").setValue("新的小任务");
    await ownerCard.find(".sub-progress").setValue(30);
    await ownerCard.findAll("button").find((button) => button.text() === "添加")!.trigger("click");

    await vi.waitFor(() => {
      const post = calls.find((call) => call.method === "POST" && call.path.endsWith("/subtasks"));
      expect(post?.body).toMatchObject({
        version: 1,
        description: "新的小任务",
        progress: 30,
        importance: "mid",
        dueDate: null,
      });
      expect(post?.body).not.toHaveProperty("ownerId");
      expect(post?.body).not.toHaveProperty("ownerIds");
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("新的小任务"));
    wrapper.unmount();
  });

  it("编辑与删除小任务：PATCH 改描述、DELETE 带 version 并确认", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.findAll("button").find((button) => button.text() === "编辑")!.trigger("click");
    await nextTick();
    await ownerCard.find(".sub-desc").setValue("改名后的小任务");
    await ownerCard.findAll("button").find((button) => button.text() === "保存")!.trigger("click");

    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH" && call.path.includes("/subtasks/sub-1"));
      expect(patch?.body).toMatchObject({ version: 1, description: "改名后的小任务" });
    });
    await vi.waitFor(() => expect(wrapper.text()).toContain("改名后的小任务"));

    await ownerCard.findAll("button").find((button) => button.text() === "删除")!.trigger("click");
    await nextTick();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog?.textContent).toContain("历史记录保留");
    (dialog!.querySelector(".btn.danger-btn") as HTMLButtonElement).click();

    await vi.waitFor(() => {
      const del = calls.find((call) => call.method === "DELETE" && call.path.includes("/subtasks/sub-1"));
      expect(del?.query).toContain("version=");
    });
    wrapper.unmount();
  });

  it("409 冲突：保留草稿并提示刷新，不伪装成功", async () => {
    forcedConflict = true;
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.find("input[type='range']").setValue(80);
    await ownerCard.findAll("button").find((button) => button.text() === "保存进度")!.trigger("click");

    await vi.waitFor(() => expect(ownerCard.text()).toContain("服务器已有新版本"));
    expect((ownerCard.find("input[type='range']").element as HTMLInputElement).value).toBe("80");
    expect(document.body.textContent).not.toContain("进度已保存");
    wrapper.unmount();
  });
});
