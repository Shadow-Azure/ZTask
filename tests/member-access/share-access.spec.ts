// @vitest-environment node
import { randomUUID } from "node:crypto";
import path from "node:path";
import { rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { readJsonFile, writeJsonAtomic } from "@ztask/server";
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

describe("home 视图分组（05 §6.4）", () => {
  it("A：owned 只含主任务 owner 的任务，collaborated 为空，B 的数据不可见", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=home", cookieA)).json();
    expectSet(descriptions(body.owned as MemberTask[]), ["A 独有任务", "A 与 B 协作", "C 被分配小任务的父任务", "含已删除小任务"]);
    expect(body.collaborated).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("B 独有任务");
  });

  it("B：owned 主任务 owner + collaborated 主任务 collaborator，互不重复", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=home", cookieB)).json();
    expectSet(descriptions(body.owned as MemberTask[]), ["B 独有任务"]);
    expectSet(descriptions(body.collaborated as MemberTask[]), ["A 与 B 协作"]);
    const allIds = [...body.owned, ...body.collaborated].map((task: MemberTask) => task.id);
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(JSON.stringify(body)).not.toContain("A 独有任务");
    expect(JSON.stringify(body)).not.toContain("C 的小任务");
  });

  it("C：仅小任务被分配者进入 collaborated，DTO 只含自己的小任务", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=home", cookieC)).json();
    expect(body.owned).toEqual([]);
    expectSet(descriptions(body.collaborated as MemberTask[]), ["C 被分配小任务的父任务"]);
    const parent = (body.collaborated as MemberTask[])[0]!;
    expectSet(parent.subtasks.map((subtask) => subtask.description), ["C 的小任务"]);
    expect(JSON.stringify(body)).not.toContain("A 的小任务");
    expect(JSON.stringify(body)).not.toContain("C 已删除的小任务");
  });
});

describe("tracker 视图（05 §6.4）", () => {
  it("B 只看到相关任务；无关任务与 A 私有任务不出现", async () => {
    const body = (await shareGet("/api/v1/share/tasks?view=tracker", cookieB)).json();
    expectSet(descriptions(body.items as MemberTask[]), ["B 独有任务", "A 与 B 协作"]);
    expect(body.nextCursor).toBeNull();
    expect(JSON.stringify(body)).not.toContain("A 独有任务");
  });

  it("view/importance/cursor 参数校验：非法值 400 INVALID_REQUEST", async () => {
    const badView = await shareGet("/api/v1/share/tasks?view=bogus", cookieA);
    expect(badView.statusCode).toBe(400);
    expect(badView.json().error.code).toBe("INVALID_REQUEST");

    const badImportance = await shareGet("/api/v1/share/tasks?view=tracker&importance=urgent", cookieA);
    expect(badImportance.statusCode).toBe(400);
    expect(badImportance.json().error.code).toBe("INVALID_REQUEST");

    const allImportance = await shareGet("/api/v1/share/tasks?view=tracker&importance=all", cookieA);
    expect(allImportance.statusCode).toBe(200);

    const invalidBase64 = await shareGet(`/api/v1/share/tasks?view=tracker&cursor=${Buffer.from("not-a-uuid").toString("base64url")}`, cookieA);
    expect(invalidBase64.statusCode).toBe(400);
    expect(invalidBase64.json().error.code).toBe("INVALID_REQUEST");

    const missingTask = await shareGet(`/api/v1/share/tasks?view=tracker&cursor=${Buffer.from(randomUUID()).toString("base64url")}`, cookieA);
    expect(missingTask.statusCode).toBe(400);

    const foreignTask = await shareGet(`/api/v1/share/tasks?view=tracker&cursor=${Buffer.from(taskB).toString("base64url")}`, cookieA);
    expect(foreignTask.statusCode).toBe(400);

    const ownTask = await shareGet(`/api/v1/share/tasks?view=tracker&cursor=${Buffer.from(taskA).toString("base64url")}`, cookieA);
    expect(ownTask.statusCode).toBe(200);
  });
});

describe("任务详情与跨成员隔离（05 §6.5 / §8）", () => {
  it("A 可读自己的主任务与小任务；B 的 taskId 对 A 返回 404 TASK_NOT_FOUND", async () => {
    const own = await shareGet(`/api/v1/share/tasks/${taskA}`, cookieA);
    expect(own.statusCode).toBe(200);
    expect(own.json().memberRole).toBe("owner");
    expect(own.json().id).toBe(taskA);

    const ownSub = await shareGet(`/api/v1/share/tasks/${subA}`, cookieA);
    expect(ownSub.statusCode).toBe(200);
    expect(ownSub.json().task.id).toBe(subA);
    expect(ownSub.json().parent.id).toBe(taskC);
    expect(ownSub.json().memberRole).toBe("owner");

    for (const id of [taskB]) {
      const foreign = await shareGet(`/api/v1/share/tasks/${id}`, cookieA);
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json().error.code).toBe("TASK_NOT_FOUND");
    }
    const foreignSub = await shareGet(`/api/v1/share/tasks/${subC}`, cookieB);
    expect(foreignSub.statusCode).toBe(404);
    expect(foreignSub.json().error.code).toBe("TASK_NOT_FOUND");
  });

  it("B 以协作者身份读 taskAB；C 读自己的小任务返回 {task,parent,memberRole} 且 parent 只含可见小任务", async () => {
    const collaboratorMain = await shareGet(`/api/v1/share/tasks/${taskAB}`, cookieB);
    expect(collaboratorMain.statusCode).toBe(200);
    expect(collaboratorMain.json().memberRole).toBe("collaborator");

    const ownSub = await shareGet(`/api/v1/share/tasks/${subC}`, cookieC);
    expect(ownSub.statusCode).toBe(200);
    const body = ownSub.json();
    expect(body.task.id).toBe(subC);
    expect(body.parent.id).toBe(taskC);
    expect(body.memberRole).toBe("collaborator");
    expect(body.parent.subtasks.map((subtask: { id: string }) => subtask.id)).toEqual([subC]);

    const otherSub = await shareGet(`/api/v1/share/tasks/${subA}`, cookieC);
    expect(otherSub.statusCode).toBe(404);
    expect(otherSub.json().error.code).toBe("TASK_NOT_FOUND");
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

    // 小任务的软删除也由同一读取路径兜底。
    const deletedSubId = (await readJsonFile(path.join(dataDir, "tasks", taskDeletedSub, "current.json")) as {
      subtasks: Array<{ id: string; deletedAt: string | null }>;
    }).subtasks.find((subtask) => subtask.deletedAt !== null)!.id;
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

describe("只读性（#19 之前无写端点）", () => {
  it("PATCH/POST/DELETE/PUT /share/tasks/** 均 404 NOT_FOUND", async () => {
    const attempts: Array<{ method: string; url: string; payload?: unknown }> = [
      { method: "PATCH", url: `/api/v1/share/tasks/${taskA}`, payload: { version: 1, progress: 50 } },
      { method: "PATCH", url: `/api/v1/share/tasks/${taskA}/progress`, payload: { version: 1, progress: 50 } },
      { method: "PATCH", url: `/api/v1/share/tasks/${taskA}/detail`, payload: { version: 1, detail: "x" } },
      { method: "POST", url: `/api/v1/share/tasks/${taskA}/subtasks`, payload: { version: 1, description: "x" } },
      { method: "PATCH", url: `/api/v1/share/tasks/${taskA}/subtasks/${subA}`, payload: { version: 1 } },
      { method: "DELETE", url: `/api/v1/share/tasks/${taskA}/subtasks/${subA}?version=1` },
      { method: "DELETE", url: `/api/v1/share/tasks/${taskA}?version=1` },
      { method: "PUT", url: `/api/v1/share/tasks/${taskA}/editor`, payload: { version: 1 } },
    ];
    for (const attempt of attempts) {
      const response = await app.inject({
        method: attempt.method as "PATCH",
        url: attempt.url,
        headers: { cookie: cookieA },
        ...(attempt.payload === undefined ? {} : { payload: attempt.payload }),
      });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
      expect(response.json().error.code).toBe("NOT_FOUND");
    }
  });
});

describe("成员可见任务夹树（05 §6.11）", () => {
  it("A 的树只含相关任务夹及祖先，不含无关任务夹名", async () => {
    const body = (await shareGet("/api/v1/share/folders/tree", cookieA)).json();
    const rootNode = (body.tree as FolderNode[]).find((node) => node.name === "迭代");
    expect(rootNode).toBeTruthy();
    expect(rootNode!.children.map((node) => node.name)).toEqual(["迭代 / 子"]);

    const childNode = rootNode!.children[0]!;
    expectSet(childNode.tasks.map((task) => task.description), ["A 与 B 协作", "C 被分配小任务的父任务"]);
    expectSet(rootNode!.tasks.map((task) => task.description), ["A 独有任务", "含已删除小任务"]);
    expect(rootNode!.counts).toEqual({ done: 0, todo: 2 });
    expect(childNode.counts).toEqual({ done: 0, todo: 2 });

    expect(JSON.stringify(body)).not.toContain("无关任务夹");
    expect(JSON.stringify(body)).not.toContain("无关子夹");
    expect(JSON.stringify(body)).not.toContain("B 独有任务");
  });

  it("B 的树包含自己任务的任务夹与祖先；C 的树只含父任务所在夹", async () => {
    const treeB = (await shareGet("/api/v1/share/folders/tree", cookieB)).json();
    const topNamesB = (treeB.tree as FolderNode[]).map((node) => node.name);
    expectSet(topNamesB, ["迭代", "无关任务夹"]);
    expect(JSON.stringify(treeB)).not.toContain("A 独有任务");

    const treeC = (await shareGet("/api/v1/share/folders/tree", cookieC)).json();
    const rootNodeC = (treeC.tree as FolderNode[]).find((node) => node.name === "迭代");
    expect(rootNodeC).toBeTruthy();
    expect(rootNodeC!.children.map((node) => node.name)).toEqual(["迭代 / 子"]);
    expectSet(rootNodeC!.children[0]!.tasks.map((task) => task.description), ["C 被分配小任务的父任务"]);
  });
});

describe("小任务 owner 兜底（对齐管理端 tasks 映射）", () => {
  it("无 owner 分配时给「待分配」摘要，不用 sub.id 冒充成员 ID", async () => {
    const currentPath = path.join(dataDir, "tasks", taskC, "current.json");
    const aggregate = (await readJsonFile(currentPath)) as { assignments: Array<{ taskId: string }> } & Record<string, unknown>;
    await writeJsonAtomic(currentPath, {
      ...aggregate,
      assignments: aggregate.assignments.filter((assignment) => assignment.taskId !== subA),
    });

    const detail = await shareGet(`/api/v1/share/tasks/${taskC}`, cookieA);
    expect(detail.statusCode).toBe(200);
    const subtask = (detail.json().subtasks as MemberTask["subtasks"]).find((entry) => entry.id === subA)!;
    expect(subtask.owner).toEqual({ id: "", name: "待分配", role: "", color: "#9aa2ae" });
    expect(subtask.owner.id).not.toBe(subA);
  });
});
