// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { VueQueryPlugin } from "@tanstack/vue-query";
import { createAppRouter } from "../../apps/web/src/router";
import { createAppQueryClient } from "../../apps/web/src/api/queryClient";
import App from "../../apps/web/src/App.vue";
import MemberTaskCard from "../../apps/web/src/features/share/MemberTaskCard.vue";
import { clearToasts, toastState } from "../../apps/web/src/components/ui/toast";
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
/** 用请求体更新指定任务并递增版本，模拟服务端写入后的最新聚合。 */
function applyMutation(taskId: string, body: Record<string, unknown>): Task {
  const task = home.owned.find((entry) => entry.id === taskId);
  if (!task) throw new Error(`unknown owned task: ${taskId}`);
  const next: Task = {
    ...task,
    progress: typeof body.progress === "number" ? body.progress : task.progress,
    detail: typeof body.detail === "string" ? body.detail : task.detail,
    version: task.version + 1,
  };
  home = { ...home, owned: home.owned.map((entry) => (entry.id === taskId ? next : entry)) };
  return next;
}

/** 当前 toast 文案列表；保存状态常驻页面，不能用 body.textContent 判断是否提示成功。 */
function toastTexts(): string[] {
  return toastState().items.map((item) => item.text);
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
    const taskWrite = url.pathname.match(/^\/api\/v1\/share\/tasks\/([^/]+)\/(progress|detail)$/);
    if (taskWrite && method === "PATCH") {
      if (forcedConflict) {
        return jsonResponse(409, {
          error: { code: "TASK_VERSION_CONFLICT", message: "任务已被其他人更新", requestId: "r-conflict" },
        });
      }
      const kind = taskWrite[2] as "progress" | "detail";
      const task = applyMutation(taskWrite[1]!, body ?? {});
      return jsonResponse(200, { task, revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: kind } });
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/subtasks" && method === "POST") {
      const task = applyMutation("t-owner", {
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
      home = {
        ...home,
        owned: home.owned.map((entry) =>
          entry.id === task.id ? { ...task, subtasks: [...task.subtasks, subtask] } : entry,
        ),
      };
      return jsonResponse(201, { task: ownedTask(), revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: "subtask" } });
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/subtasks/sub-1" && method === "PATCH") {
      const task = applyMutation("t-owner", body ?? {});
      const subtasks = task.subtasks.map((sub) =>
        sub.id === "sub-1" ? { ...sub, description: String(body?.description ?? sub.description) } : sub,
      );
      home = { ...home, owned: home.owned.map((entry) => (entry.id === task.id ? { ...task, subtasks } : entry)) };
      return jsonResponse(200, { task: ownedTask(), revision: { taskVersion: task.version, recordedAt: "2026-11-02T00:00:00.000Z", changeKind: "subtask" } });
    }
    if (url.pathname === "/api/v1/share/tasks/t-owner/subtasks/sub-1" && method === "DELETE") {
      const task = applyMutation("t-owner", {});
      home = {
        ...home,
        owned: home.owned.map((entry) =>
          entry.id === task.id ? { ...task, subtasks: task.subtasks.filter((sub) => sub.id !== "sub-1") } : entry,
        ),
      };
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
    others: [],
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
  it("owner 卡只有一个「保存」、自动保存状态与小任务控件；collaborator 卡保持只读", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    expect(ownerCard.findAll(".foot button")).toHaveLength(1);
    expect(ownerCard.find(".foot button").text()).toBe("保存");
    expect(ownerCard.text()).not.toContain("保存进度");
    expect(ownerCard.text()).not.toContain("保存详情");
    expect(ownerCard.text()).toContain("停顿 2 秒自动保存");
    expect(ownerCard.text()).toContain("保存整页");
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

  it("保存：只提交有改动的进度，请求携带 version", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.find("input[type='range']").setValue(65);
    await ownerCard.find(".foot button").trigger("click");

    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/progress"));
      expect(patch?.body).toEqual({ progress: 65, version: 1 });
    });
    expect(calls.find((call) => call.method === "PATCH" && call.path.endsWith("/detail"))).toBeUndefined();
    await vi.waitFor(() => expect(toastTexts()).toContain("已保存"));
    wrapper.unmount();
  });

  it("保存详情：进度不变时只提交详情并携带 version（只改详情不再被两个按钮卡住）", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.find("textarea").setValue("完整替换后的进展详情");
    await ownerCard.find(".foot button").trigger("click");

    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/detail"));
      expect(patch?.body).toEqual({ detail: "完整替换后的进展详情", version: 1 });
    });
    expect(calls.find((call) => call.method === "PATCH" && call.path.endsWith("/progress"))).toBeUndefined();
    await vi.waitFor(() => expect(toastTexts()).toContain("已保存"));
    wrapper.unmount();
  });

  it("保存：同一任务的进度与详情串行提交，详情使用进度响应后的新 version", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.find("input[type='range']").setValue(85);
    await ownerCard.find("textarea").setValue("进度和详情一起改");
    await ownerCard.find(".foot button").trigger("click");

    await vi.waitFor(() => {
      const progress = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/progress"));
      const detail = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/detail"));
      expect(progress?.body).toEqual({ progress: 85, version: 1 });
      expect(detail?.body).toEqual({ detail: "进度和详情一起改", version: 2 });
    });
    await vi.waitFor(() => expect(ownerCard.text()).toContain("✓ 已保存"));
    wrapper.unmount();
  });

  it("自动保存：编辑停顿 2 秒后提交，状态显示自动保存时间", async () => {
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的任务"));

    const ownerCard = card(wrapper, 0);
    await ownerCard.find("textarea").setValue("自动保存的新详情");
    await vi.waitFor(
      () => {
        const patch = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/detail"));
        expect(patch?.body).toEqual({ detail: "自动保存的新详情", version: 1 });
      },
      { timeout: 4000, interval: 100 },
    );
    await vi.waitFor(() => expect(ownerCard.text()).toContain("✓ 已自动保存"), { timeout: 4000 });
    wrapper.unmount();
  });

  it("Ctrl+S：保存整页所有任务卡的草稿", async () => {
    home = {
      ...home,
      owned: [
        ...home.owned,
        makeTask({ id: "t-owner-2", description: "我负责的第二个任务", progress: 10, detail: "第二任务详情", subtasks: [] }),
      ],
    };
    const { wrapper } = await mountHome();
    await vi.waitFor(() => expect(wrapper.text()).toContain("我负责的第二个任务"));

    const [firstCard, secondCard] = wrapper.findAll(".stask");
    await firstCard!.find("textarea").setValue("第一张卡的新详情");
    await secondCard!.find("input[type='range']").setValue(35);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }));

    await vi.waitFor(() => {
      const detail = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/detail"));
      const progress = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/progress"));
      expect(detail?.body).toEqual({ detail: "第一张卡的新详情", version: 1 });
      expect(progress?.body).toEqual({ progress: 35, version: 1 });
    });
    await vi.waitFor(() => expect(toastTexts()).toContain("已保存整页修改"));
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
    await ownerCard.find(".sub-editor .btn.primary").trigger("click");

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
    await ownerCard.find(".foot button").trigger("click");

    await vi.waitFor(() => expect(ownerCard.text()).toContain("服务器已有新版本"));
    expect((ownerCard.find("input[type='range']").element as HTMLInputElement).value).toBe("80");
    expect(toastTexts()).not.toContain("已保存");
    wrapper.unmount();
  });
});

describe("草稿与服务端更新（08 §6.2）", () => {
  it("未保存的进度/详情草稿不会被轮询或他人更新覆盖", async () => {
    const task = makeTask({ id: "t-owner", description: "我负责的任务" });
    const wrapper = mount(MemberTaskCard, {
      props: { task, editable: true },
      global: { plugins: [[VueQueryPlugin, { queryClient: createAppQueryClient() }]] },
    });

    await wrapper.find("input[type='range']").setValue(90);
    await wrapper.find("textarea").setValue("我的未保存草稿");
    await wrapper.setProps({ task: { ...task, progress: 55, detail: "他人保存的新详情", version: 2 } });

    expect((wrapper.find("input[type='range']").element as HTMLInputElement).value).toBe("90");
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("我的未保存草稿");

    // 基线版本在第一次编辑时锁定为 1；即使 props 前进到 v2，首个提交仍带 v1 → 服务端能判出 409。
    calls = [];
    await wrapper.find(".foot button").trigger("click");
    await vi.waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH" && call.path.endsWith("/progress"));
      expect(patch?.body).toEqual({ progress: 90, version: 1 });
    });
    wrapper.unmount();
  });
});
