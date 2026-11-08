// @vitest-environment node
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTaskStore, readTaskAggregate } from "@ztask/server";
import {
  createFolder,
  createMember,
  createMemberAccessApp,
  createSubtask,
  createTask,
  deleteTask,
  exchangeCookie,
  seedShareLink,
  tmpDataDir,
} from "./support/share-fixtures.js";

interface MemberTask {
  id: string;
  description: string;
  detail: string;
  subtasks: Array<{ id: string; description: string; owner: { id: string; name: string } }>;
}

interface FolderNode {
  name: string;
  tasks: Array<{ description: string }>;
  counts: { done: number; todo: number };
  children: FolderNode[];
}

let dataDir: string;
let app: FastifyInstance;
let memberA: string;
let memberB: string;
let memberC: string;
let root: string;
let child: string;
let unrelated: string;
let unrelatedChild: string;
let taskA: string;
let taskB: string;
let taskAB: string;
let taskC: string;
let subC: string;
let subA: string;
let taskDeleted: string;
let taskDeletedSub: string;
let tokenA: string;
let tokenB: string;
let cookieA: string;
let cookieB: string;
let cookieC: string;

function descriptions(items: MemberTask[]): string[] {
  return items.map((item) => item.description);
}

function expectSet(actual: string[], expected: string[]): void {
  expect([...actual].sort()).toEqual([...expected].sort());
}

type InjectResponse = Awaited<ReturnType<FastifyInstance["inject"]>>;

async function shareGet(url: string, cookie: string): Promise<InjectResponse> {
  return await app.inject({ method: "GET", url, headers: { cookie } });
}

beforeEach(async () => {
  dataDir = tmpDataDir();
  app = await createMemberAccessApp(dataDir);

  root = await createFolder(app, "迭代");
  child = await createFolder(app, "迭代 / 子", root);
  unrelated = await createFolder(app, "无关任务夹");
  unrelatedChild = await createFolder(app, "无关子夹", unrelated);

  memberA = await createMember(app, "陈晨");
  memberB = await createMember(app, "林悦");
  memberC = await createMember(app, "周舟");

  taskA = (await createTask(app, { folderId: root, description: "A 独有任务", ownerIds: [memberA] })).id;
  taskB = (await createTask(app, { folderId: unrelatedChild, description: "B 独有任务", ownerIds: [memberB] })).id;
  taskAB = (await createTask(app, { folderId: child, description: "A 与 B 协作", ownerIds: [memberA], collaboratorIds: [memberB] })).id;
  taskC = (await createTask(app, { folderId: child, description: "C 被分配小任务的父任务", ownerIds: [memberA] })).id;
  subC = (await createSubtask(app, { folderId: child, parentId: taskC, description: "C 的小任务", ownerId: memberC })).id;
  subA = (await createSubtask(app, { folderId: child, parentId: taskC, description: "A 的小任务", ownerId: memberA })).id;
  const deletedSubC = await createSubtask(app, { folderId: child, parentId: taskC, description: "C 已删除的小任务", ownerId: memberC });
  await deleteTask(app, deletedSubC.id, deletedSubC.parentVersion);

  const deleted = await createTask(app, { folderId: root, description: "已删除任务", ownerIds: [memberA] });
  await deleteTask(app, deleted.id, deleted.version);
  taskDeleted = deleted.id;

  const withDeletedSub = await createTask(app, { folderId: root, description: "含已删除小任务", ownerIds: [memberA] });
  const deletedSub = await createSubtask(app, { folderId: root, parentId: withDeletedSub.id, description: "已删除小任务", ownerId: memberA });
  await deleteTask(app, deletedSub.id, deletedSub.parentVersion);
  taskDeletedSub = withDeletedSub.id;

  ({ token: tokenA } = await seedShareLink({ dataDir, memberId: memberA }));
  ({ token: tokenB } = await seedShareLink({ dataDir, memberId: memberB }));
  const tokenC = (await seedShareLink({ dataDir, memberId: memberC })).token;
  cookieA = await exchangeCookie(app, tokenA);
  cookieB = await exchangeCookie(app, tokenB);
  cookieC = await exchangeCookie(app, tokenC);
});

afterEach(async () => {
  await app.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe("home 视图分组（05 §6.4 / 07 §5.1）", () => {
  it("A：owned 含自己负责的全部任务，others 含其他成员任务，三组不重不漏", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=home", cookieA)).json();
    expectSet(descriptions(body.owned as MemberTask[]), ["A 独有任务", "A 与 B 协作", "C 被分配小任务的父任务", "含已删除小任务"]);
    expect(body.collaborated).toEqual([]);
    expectSet(descriptions(body.others as MemberTask[]), ["B 独有任务"]);

    const parent = (body.owned as MemberTask[]).find((task) => task.id === taskC)!;
    expect(parent.detail).toBe("C 被分配小任务的父任务详情");

    const all = [...body.owned, ...body.collaborated, ...body.others] as MemberTask[];
    expect(new Set(all.map((task) => task.id)).size).toBe(all.length);
  });

  it("B：owned / collaborated / others 覆盖团队全部任务，互不重复", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=home", cookieB)).json();
    expectSet(descriptions(body.owned as MemberTask[]), ["B 独有任务"]);
    expectSet(descriptions(body.collaborated as MemberTask[]), ["A 与 B 协作"]);
    expectSet(descriptions(body.others as MemberTask[]), ["A 独有任务", "C 被分配小任务的父任务", "含已删除小任务"]);
    const all = [...body.owned, ...body.collaborated, ...body.others] as MemberTask[];
    expect(new Set(all.map((task) => task.id)).size).toBe(all.length);
    expect(new Set(all.map((task) => task.id)).size).toBe(5);
  });

  it("C：仅小任务被分配者不进入 owned/collaborated，父任务归入 others 且详情完整", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=home", cookieC)).json();
    expect(body.owned).toEqual([]);
    expect(body.collaborated).toEqual([]);
    expectSet(descriptions(body.others as MemberTask[]), [
      "A 独有任务",
      "B 独有任务",
      "A 与 B 协作",
      "C 被分配小任务的父任务",
      "含已删除小任务",
    ]);
    const parent = (body.others as MemberTask[]).find((task) => task.id === taskC)!;
    expect(parent.detail).toBe("C 被分配小任务的父任务详情");
    expectSet(parent.subtasks.map((subtask) => subtask.description), ["C 的小任务", "A 的小任务"]);
  });
});

describe("tracker 视图（05 §6.4 / 07 §5.1）", () => {
  it("B 看到团队全部任务，不再按成员关系裁剪", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=tracker", cookieB)).json();
    expectSet(descriptions(body.items as MemberTask[]), [
      "A 独有任务",
      "B 独有任务",
      "A 与 B 协作",
      "C 被分配小任务的父任务",
      "含已删除小任务",
    ]);
    expect(body.nextCursor).toBeNull();
    expect(JSON.stringify(body)).toContain("A 独有任务");
  });

  it("C 看到全部任务与完整父任务详情、全部未删除小任务", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=tracker", cookieC)).json();
    expectSet(descriptions(body.items as MemberTask[]), [
      "A 独有任务",
      "B 独有任务",
      "A 与 B 协作",
      "C 被分配小任务的父任务",
      "含已删除小任务",
    ]);
    const parent = (body.items as MemberTask[]).find((task) => task.id === taskC)!;
    expect(parent.detail).toBe("C 被分配小任务的父任务详情");
    expectSet(parent.subtasks.map((subtask) => subtask.description), ["C 的小任务", "A 的小任务"]);
    expect(JSON.stringify(body)).not.toContain("C 已删除的小任务");
  });

  it("view/importance 参数校验：非法值 400 INVALID_REQUEST", async () => {
    const badView = await shareGet("/api/v1/share/tasks?view=bogus", cookieA);
    expect(badView.statusCode).toBe(400);
    expect(badView.json().error.code).toBe("INVALID_REQUEST");

    const badImportance = await shareGet("/api/v1/share/tasks?view=tracker&importance=urgent", cookieA);
    expect(badImportance.statusCode).toBe(400);
    expect(badImportance.json().error.code).toBe("INVALID_REQUEST");

    const allImportance = await shareGet("/api/v1/share/tasks?view=tracker&importance=all", cookieA);
    expect(allImportance.statusCode).toBe(200);
  });
});

describe("任务详情（全员可见）", () => {
  it("A 可读自己的主任务与小任务；B 的主任务对 A 也可读，角色为 viewer", async () => {
    const own = await shareGet(`/api/v1/share/tasks/${taskA}`, cookieA);
    expect(own.statusCode).toBe(200);
    expect(own.json().memberRole).toBe("owner");
    expect(own.json().id).toBe(taskA);

    const ownSub = await shareGet(`/api/v1/share/tasks/${subA}`, cookieA);
    expect(ownSub.statusCode).toBe(200);
    expect(ownSub.json().task.id).toBe(subA);
    expect(ownSub.json().parent.id).toBe(taskC);
    expect(ownSub.json().memberRole).toBe("owner");

    const foreign = await shareGet(`/api/v1/share/tasks/${taskB}`, cookieA);
    expect(foreign.statusCode).toBe(200);
    expect(foreign.json().id).toBe(taskB);
    expect(foreign.json().memberRole).toBe("viewer");
    expect(foreign.json().detail).toBe("B 独有任务详情");

    const foreignSub = await shareGet(`/api/v1/share/tasks/${subC}`, cookieA);
    expect(foreignSub.statusCode).toBe(200);
    expect(foreignSub.json().memberRole).toBe("owner");
  });

  it("B 以协作者身份读 taskAB；C 读自己的小任务返回 {task,parent,memberRole} 且 parent 详情完整", async () => {
    const collaboratorMain = await shareGet(`/api/v1/share/tasks/${taskAB}`, cookieB);
    expect(collaboratorMain.statusCode).toBe(200);
    expect(collaboratorMain.json().memberRole).toBe("collaborator");
    expect(collaboratorMain.json().detail).toBe("A 与 B 协作详情");

    const ownSub = await shareGet(`/api/v1/share/tasks/${subC}`, cookieC);
    expect(ownSub.statusCode).toBe(200);
    const body = ownSub.json();
    expect(body.task.id).toBe(subC);
    expect(body.parent.id).toBe(taskC);
    expect(body.memberRole).toBe("viewer");
    expectSet(body.parent.subtasks.map((subtask: { id: string }) => subtask.id), [subA, subC]);
    expect(body.parent.detail).toBe("C 被分配小任务的父任务详情");
    expect(body.parent.description).toBe("C 被分配小任务的父任务");

    const otherSub = await shareGet(`/api/v1/share/tasks/${subA}`, cookieC);
    expect(otherSub.statusCode).toBe(200);
    expect(otherSub.json().task.id).toBe(subA);
    expect(otherSub.json().memberRole).toBe("viewer");

    const parentTask = await shareGet(`/api/v1/share/tasks/${taskC}`, cookieC);
    expect(parentTask.statusCode).toBe(200);
    expect(parentTask.json().detail).toBe("C 被分配小任务的父任务详情");
    expectSet(parentTask.json().subtasks.map((subtask: { id: string }) => subtask.id), [subA, subC]);

    const foreignTask = await shareGet(`/api/v1/share/tasks/${taskB}`, cookieC);
    expect(foreignTask.statusCode).toBe(200);
    expect(foreignTask.json().id).toBe(taskB);
    expect(foreignTask.json().memberRole).toBe("viewer");
  });

  it("非法 / 不存在 / 软删除 id 一律 404 TASK_NOT_FOUND（不 500、不泄露存储错误）", async () => {
    const invalid = await shareGet("/api/v1/share/tasks/not-a-uuid", cookieA);
    expect(invalid.statusCode).toBe(404);
    expect(invalid.json().error.code).toBe("TASK_NOT_FOUND");

    const missing = await shareGet(`/api/v1/share/tasks/${randomUUID()}`, cookieA);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("TASK_NOT_FOUND");

    const deleted = await shareGet(`/api/v1/share/tasks/${taskDeleted}`, cookieA);
    expect(deleted.statusCode).toBe(404);

    const deletedAggregate = await readTaskAggregate(dataDir, taskDeletedSub);
    const deletedSubId = deletedAggregate!.subtasks.find((subtask) => subtask.deletedAt !== null)!.id;
    const deletedSub = await shareGet(`/api/v1/share/tasks/${deletedSubId}`, cookieA);
    expect(deletedSub.statusCode).toBe(404);
  });

  it("响应 JSON 不含 token / tokenHash / verifier", async () => {
    const detail = await shareGet(`/api/v1/share/tasks/${taskC}`, cookieA);
    expect(detail.statusCode).toBe(200);
    for (const secret of [tokenA, tokenB]) {
      expect(detail.body).not.toContain(secret);
    }
    expect(detail.body).not.toContain("verifier");
    expect(detail.body).not.toContain("tokenHash");

    const home = await shareGet("/api/v1/share/tasks?view=home", cookieC);
    expect(home.body).not.toContain(tokenA);
    expect(home.body).not.toContain("tokenHash");
  });
});

describe("软删除不可见", () => {
  it("软删除主任务/小任务不出现在 home、tracker、详情与树中", async () => {
    const home = (await shareGet("/api/v1/share/tasks?view=home", cookieA)).json();
    expect(JSON.stringify(home)).not.toContain("已删除任务");

    const tracker = (await shareGet("/api/v1/share/tasks?view=tracker", cookieA)).json();
    expect(JSON.stringify(tracker)).not.toContain("已删除任务");

    const deletedDetail = await shareGet(`/api/v1/share/tasks/${taskDeleted}`, cookieA);
    expect(deletedDetail.statusCode).toBe(404);

    const parentOfDeletedSub = await shareGet(`/api/v1/share/tasks/${taskDeletedSub}`, cookieA);
    expect(parentOfDeletedSub.statusCode).toBe(200);
    expect(parentOfDeletedSub.json().subtasks).toEqual([]);

    const tree = (await shareGet("/api/v1/share/folders/tree", cookieA)).json();
    expect(JSON.stringify(tree)).not.toContain("已删除任务");
  });
});

describe("写端点边界（#19 起只开放 §6.6–6.10 五条写路由）", () => {
  it("未注册的写路径仍 404 NOT_FOUND；跨父任务 subtaskId 是 404 TASK_NOT_FOUND", async () => {
    // 主任务整体编辑/删除与编辑器端点不随 #19 开放，保持 404。
    const unregistered: Array<{ method: "PATCH" | "PUT" | "DELETE"; url: string; payload?: unknown }> = [
      { method: "PATCH", url: `/api/v1/share/tasks/${taskA}`, payload: { version: 1, progress: 50 } },
      { method: "PUT", url: `/api/v1/share/tasks/${taskA}/editor`, payload: { version: 1 } },
      { method: "DELETE", url: `/api/v1/share/tasks/${taskA}?version=1` },
    ];
    for (const attempt of unregistered) {
      const response = await app.inject({
        method: attempt.method,
        url: attempt.url,
        headers: { cookie: cookieA },
        ...(attempt.payload === undefined ? {} : { payload: attempt.payload }),
      });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
      expect(response.json().error.code).toBe("NOT_FOUND");
    }

    // 小任务写端点只认路径上的父任务：subC 属于 taskC，对 taskA 一律 404。
    const crossParent: Array<{ method: "PATCH" | "DELETE"; url: string; payload?: unknown }> = [
      { method: "PATCH", url: `/api/v1/share/tasks/${taskA}/subtasks/${subC}`, payload: { version: 1, description: "x" } },
      { method: "DELETE", url: `/api/v1/share/tasks/${taskA}/subtasks/${subC}?version=1` },
    ];
    for (const attempt of crossParent) {
      const response = await app.inject({
        method: attempt.method,
        url: attempt.url,
        headers: { cookie: cookieA },
        ...(attempt.payload === undefined ? {} : { payload: attempt.payload }),
      });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
      expect(response.json().error.code).toBe("TASK_NOT_FOUND");
    }
  });
});

describe("成员任务夹树（05 §6.11）", () => {
  it("A 的树是完整团队树，包含无关任务夹与全部任务", async () => {
    const body = (await shareGet("/api/v1/share/folders/tree", cookieA)).json();
    const topNames = (body.tree as FolderNode[]).map((node) => node.name);
    expectSet(topNames, ["迭代", "无关任务夹"]);

    const rootNode = (body.tree as FolderNode[]).find((node) => node.name === "迭代")!;
    expect(rootNode.children.map((node) => node.name)).toEqual(["迭代 / 子"]);
    expectSet(rootNode.tasks.map((task) => task.description), ["A 独有任务", "含已删除小任务"]);
    const childNode = rootNode.children[0]!;
    expectSet(childNode.tasks.map((task) => task.description), ["A 与 B 协作", "C 被分配小任务的父任务"]);
    expect(rootNode.counts).toEqual({ done: 0, todo: 2 });
    expect(childNode.counts).toEqual({ done: 0, todo: 2 });

    const unrelatedNode = (body.tree as FolderNode[]).find((node) => node.name === "无关任务夹")!;
    expectSet(unrelatedNode.children[0]!.tasks.map((task) => task.description), ["B 独有任务"]);
    expect(JSON.stringify(body)).not.toContain("已删除任务");
  });

  it("B / C 也拿到同一棵完整树", async () => {
    for (const cookie of [cookieB, cookieC]) {
      const body = (await shareGet("/api/v1/share/folders/tree", cookie)).json();
      const topNames = (body.tree as FolderNode[]).map((node) => node.name);
      expectSet(topNames, ["迭代", "无关任务夹"]);
      expect(JSON.stringify(body)).toContain("A 独有任务");
      expect(JSON.stringify(body)).toContain("B 独有任务");
      expect(JSON.stringify(body)).toContain("C 被分配小任务的父任务");
    }
  });
});

describe("小任务 owner 兜底（对齐管理端 tasks 映射）", () => {
  it("无 owner 分配时给「待分配」摘要，不用 sub.id 冒充成员 ID", async () => {
    const aggregate = await readTaskAggregate(dataDir, taskC);
    if (!aggregate) throw new Error("taskC missing");
    const tasks = createTaskStore({ dataDir });
    await tasks.commit(taskC, {
      expectedVersion: aggregate.taskVersion,
      changeKind: "update",
      actor: { kind: "admin", memberId: null, name: "管理员" },
      mutate: (draft) => {
        draft.assignments = draft.assignments.filter((assignment) => assignment.taskId !== subA);
      },
    });

    const detail = await shareGet(`/api/v1/share/tasks/${taskC}`, cookieA);
    expect(detail.statusCode).toBe(200);
    const subtask = (detail.json().subtasks as MemberTask["subtasks"]).find((entry) => entry.id === subA)!;
    expect(subtask.owner).toEqual({ id: "", name: "待分配", role: "", color: "#9aa2ae" });
    expect(subtask.owner.id).not.toBe(subA);
  });
});
