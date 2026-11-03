import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTaskStore, createEntityStore, initStore } from "@ztask/server";
import type { TaskAggregate } from "@ztask/server";

const FOLDER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOLDER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK_1 = "11111111-1111-4111-8111-111111111111";
const TASK_2 = "22222222-2222-4222-8222-222222222222";
const MEMBER_X = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MEMBER_Y = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `ztask-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function task(folderId: string, progress: number, deletedAt: string | null = null) {
  return {
    folderId, parentId: null, description: `任务@${folderId.slice(0, 4)}`, progress,
    detailText: "", importance: "mid" as const, dueDate: null,
    createdAt: "2026-11-01T01:00:00.000Z", deletedAt,
  };
}

function actor() {
  return { kind: "admin" as const, memberId: null, name: "管理员" };
}

describe("派生索引", () => {
  it("从聚合与实体文件重建 byId/folderChildren/active/history/assignments/owners", async () => {
    const boot = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const tasks = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    await tasks.createAggregate({
      taskId: TASK_1, task: task(FOLDER_A, 40), subtasks: [], assignments: [
        { taskId: TASK_1, memberId: MEMBER_X, kind: "owner" },
        { taskId: TASK_1, memberId: MEMBER_Y, kind: "collaborator" },
      ], actor: actor(),
    });
    await tasks.createAggregate({
      taskId: TASK_2, task: task(FOLDER_B, 0, "2026-11-02T00:00:00.000Z"), subtasks: [], assignments: [
        { taskId: TASK_2, memberId: MEMBER_X, kind: "owner" },
      ], actor: actor(),
    });
    const folders = createEntityStore<{ id: string; parentId: string | null; name: string }>({ dataDir, subdir: "folders" });
    await folders.put(FOLDER_A, { id: FOLDER_A, parentId: null, name: "A" });
    await folders.put(FOLDER_B, { id: FOLDER_B, parentId: FOLDER_A, name: "B" });

    const indexes = await boot.rebuildIndexes();
    expect(indexes.byId.size).toBe(2);

    // folderChildren：A 的孩子是 B
    expect(indexes.folderChildren.get(null)).toContain(FOLDER_A);
    expect(indexes.folderChildren.get(FOLDER_A)).toContain(FOLDER_B);

    // active vs history（含软删除）
    expect(indexes.activeTasksByFolder.get(FOLDER_A)).toContain(TASK_1);
    expect(indexes.activeTasksByFolder.get(FOLDER_B)).toBeUndefined();
    expect(indexes.historyTasksByFolder.get(FOLDER_B)).toContain(TASK_2);

    // assignmentsByMember：按 memberId 聚合 taskId
    expect(indexes.assignmentsByMember.get(MEMBER_X)?.sort()).toEqual([TASK_1, TASK_2].sort());
    expect(indexes.assignmentsByMember.get(MEMBER_Y)).toEqual([TASK_1]);

    // activeOwnersByTask
    expect(indexes.activeOwnersByTask.get(TASK_1)).toEqual([MEMBER_X]);
    expect(indexes.activeOwnersByTask.get(TASK_2)).toEqual([MEMBER_X]);
  });

  it("小任务父级与有效小任务 owner 索引从聚合重建", async () => {
    const boot = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const tasks = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    const subtaskId = "33333333-3333-4333-8333-333333333333";
    await tasks.createAggregate({
      taskId: TASK_1,
      task: task(FOLDER_A, 40),
      subtasks: [{
        id: subtaskId, parentId: TASK_1, folderId: FOLDER_A, description: "子任务",
        progress: 20, importance: "mid", dueDate: null,
        createdAt: "2026-11-01T01:00:00.000Z", deletedAt: null,
      }],
      assignments: [
        { taskId: TASK_1, memberId: MEMBER_X, kind: "owner" },
        { taskId: subtaskId, memberId: MEMBER_Y, kind: "owner" },
      ],
      actor: actor(),
    });

    const indexes = await boot.rebuildIndexes();
    expect(indexes.parentBySubtaskId.get(subtaskId)).toBe(TASK_1);
    expect(indexes.activeSubtaskOwnersByTask.get(TASK_1)).toEqual([MEMBER_Y]);
  });

  it("重启后重建的索引与首次一致", async () => {
    const boot1 = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const tasks = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    await tasks.createAggregate({
      taskId: TASK_1, task: task(FOLDER_A, 40), subtasks: [], assignments: [
        { taskId: TASK_1, memberId: MEMBER_X, kind: "owner" },
      ], actor: actor(),
    });
    const firstIndexes = await boot1.rebuildIndexes();

    const boot2 = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const secondIndexes = await boot2.rebuildIndexes();

    const serialize = (indexes: { byId: Map<string, TaskAggregate> }) => JSON.stringify([...indexes.byId.keys()].sort());
    expect(serialize(secondIndexes)).toBe(serialize(firstIndexes));
    expect(secondIndexes.activeOwnersByTask.get(TASK_1)).toEqual(firstIndexes.activeOwnersByTask.get(TASK_1));
  });
});

describe("通用实体存储（members/folders/share-links/auth-sessions 统一接口）", () => {
  it("put/get/list 幂等且原子", async () => {
    const members = createEntityStore<{ id: string; name: string }>({ dataDir, subdir: "members" });
    await members.put(MEMBER_X, { id: MEMBER_X, name: "陈晨" });
    await members.put(MEMBER_X, { id: MEMBER_X, name: "陈晨改" });
    await members.put(MEMBER_Y, { id: MEMBER_Y, name: "李泠" });

    expect(await members.get(MEMBER_X)).toEqual({ id: MEMBER_X, name: "陈晨改" });
    const all = await members.list();
    expect(all.length).toBe(2);
    expect(all.map((e) => e.value.name).sort()).toEqual(["李泠", "陈晨改"]);
  });

  it("非法 ID 拒绝，缺失返回 null", async () => {
    const members = createEntityStore<{ id: string; name: string }>({ dataDir, subdir: "members" });
    await expect(members.put("../evil", { id: "x", name: "x" })).rejects.toThrow();
    expect(await members.get(MEMBER_X)).toBeNull();
  });
});
