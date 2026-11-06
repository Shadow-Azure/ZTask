import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EntryNotFoundError,
  VersionConflictError,
  canonicalJson,
  checksumOf,
  initStore,
  readTaskAggregate,
  type RevisionLine,
  type TaskStoreHooks,
  type ZtaskStore,
} from "@ztask/server";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const MEMBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLOCK = "2026-11-02T03:00:00.000Z";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "ztask-taskspec-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function rawTask() {
  return {
    folderId: FOLDER_ID,
    parentId: null,
    description: "任务树组件重构",
    progress: 10,
    detailText: "初始详情",
    importance: "high" as const,
    dueDate: null,
    createdAt: "2026-11-01T01:00:00.000Z",
    deletedAt: null,
  };
}

function baseTask(overrides: Partial<ReturnType<typeof rawTask>> = {}) {
  return { ...rawTask(), ...overrides };
}

function actor() {
  return { kind: "admin" as const, memberId: null, name: "管理员" };
}

async function makeStore(hooks?: TaskStoreHooks): Promise<ZtaskStore> {
  const store = await initStore({
    dataDir,
    applicationVersion: "0.1.0",
    clock: () => new Date(CLOCK),
    ...(hooks === undefined ? {} : { hooks }),
  });
  await store.folders.put(FOLDER_ID, { id: FOLDER_ID, parentId: null, name: "任务夹", position: 0 });
  await store.members.put(MEMBER_ID, {
    id: MEMBER_ID,
    name: "陈晨",
    role: "前端工程师",
    color: "#2f6fe0",
    archivedAt: null,
  });
  return store;
}

async function revisionsOf(store: ZtaskStore, taskId = TASK_ID): Promise<RevisionLine[]> {
  const lines: RevisionLine[] = [];
  await store.tasks.readRevisions(taskId, (line) => {
    lines.push(line);
  });
  return lines;
}

describe("createAggregate", () => {
  it("创建 version=1 聚合与一条 create revision", async () => {
    const store = await makeStore();
    const aggregate = await store.tasks.createAggregate({
      taskId: TASK_ID,
      task: baseTask(),
      subtasks: [],
      assignments: [{ taskId: TASK_ID, memberId: MEMBER_ID, kind: "owner" }],
      actor: actor(),
    });
    expect(aggregate.taskVersion).toBe(1);
    expect(aggregate.revisionTip.changeKind).toBe("create");

    const onDisk = await readTaskAggregate(dataDir, TASK_ID);
    expect(onDisk?.task.description).toBe("任务树组件重构");
    const lines = await revisionsOf(store);
    expect(lines.length).toBe(1);
    const [line] = lines;
    expect(line?.changeKind).toBe("create");
    expect(line?.actor.kind).toBe("admin");
    const { checksum, ...rest } = line!;
    expect(checksumOf(rest)).toBe(checksum);
    await store.close();
  });

  it("非法 taskId 直接拒绝", async () => {
    const store = await makeStore();
    await expect(
      store.tasks.createAggregate({ taskId: "../evil", task: baseTask(), subtasks: [], assignments: [], actor: actor() }),
    ).rejects.toThrow();
    await expect(readTaskAggregate(dataDir, "../evil")).rejects.toThrow();
    await store.close();
  });

  it("重复创建同一聚合报错，不产生第二条 revision", async () => {
    const store = await makeStore();
    await store.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await expect(
      store.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() }),
    ).rejects.toThrow();
    expect((await revisionsOf(store)).length).toBe(1);
    await store.close();
  });
});

describe("commit", () => {
  it("版本匹配时递增版本并写入完整 revision", async () => {
    const store = await makeStore();
    await store.tasks.createAggregate({
      taskId: TASK_ID,
      task: baseTask(),
      subtasks: [],
      assignments: [{ taskId: TASK_ID, memberId: MEMBER_ID, kind: "owner" }],
      actor: actor(),
    });

    const updated = await store.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: { kind: "member", memberId: MEMBER_ID, name: "陈晨" },
      mutate: (draft) => {
        draft.task.progress = 40;
        draft.task.detailText = "更新后的详情";
      },
    });
    expect(updated.taskVersion).toBe(2);
    expect(updated.task.progress).toBe(40);
    expect(updated.revisionTip.changeKind).toBe("progress");

    const lines = await revisionsOf(store);
    expect(lines.map((line) => line.taskVersion)).toEqual([1, 2]);
    expect(lines[1]?.actor).toEqual({ kind: "member", memberId: MEMBER_ID, name: "陈晨" });
    expect(lines[1]?.snapshot.task.detailText).toBe("更新后的详情");
    await store.close();
  });

  it("过期 expectedVersion 返回 VersionConflictError，版本不变", async () => {
    const store = await makeStore();
    await store.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await expect(
      store.tasks.commit(TASK_ID, {
        expectedVersion: 0,
        changeKind: "progress",
        actor: actor(),
        mutate: (draft) => {
          draft.task.progress = 99;
        },
      }),
    ).rejects.toBeInstanceOf(VersionConflictError);
    expect((await readTaskAggregate(dataDir, TASK_ID))?.task.progress).toBe(10);
    await store.close();
  });

  it("无实际变化不写 revision", async () => {
    const store = await makeStore();
    await store.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    const unchanged = await store.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "update",
      actor: actor(),
      mutate: () => undefined,
    });
    expect(unchanged.taskVersion).toBe(1);
    expect((await revisionsOf(store)).length).toBe(1);
    await store.close();
  });

  it("并发提交同聚合只有一个成功", async () => {
    const store = await makeStore();
    await store.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    const results = await Promise.allSettled([
      store.tasks.commit(TASK_ID, {
        expectedVersion: 1,
        changeKind: "progress",
        actor: actor(),
        mutate: (draft) => {
          draft.task.progress = 30;
        },
      }),
      store.tasks.commit(TASK_ID, {
        expectedVersion: 1,
        changeKind: "progress",
        actor: actor(),
        mutate: (draft) => {
          draft.task.progress = 60;
        },
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
    expect(results.find((result) => result.status === "rejected")?.reason).toBeInstanceOf(VersionConflictError);
    expect((await readTaskAggregate(dataDir, TASK_ID))?.taskVersion).toBe(2);
    expect((await revisionsOf(store)).length).toBe(2);
    await store.close();
  });

  it("任务不存在返回 EntryNotFoundError", async () => {
    const store = await makeStore();
    await expect(
      store.tasks.commit(TASK_ID, {
        expectedVersion: 1,
        changeKind: "update",
        actor: actor(),
        mutate: () => undefined,
      }),
    ).rejects.toBeInstanceOf(EntryNotFoundError);
    await store.close();
  });
});

describe("事务回滚", () => {
  it("afterAppend 抛错时 revision 与当前状态都不落库", async () => {
    const store = await makeStore({
      afterAppend: () => {
        throw new Error("injected afterAppend");
      },
    });
    await expect(
      store.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() }),
    ).rejects.toThrow("injected afterAppend");
    expect(await readTaskAggregate(dataDir, TASK_ID)).toBeNull();
    await store.close();
  });

  it("afterPublish 抛错时整个提交回滚", async () => {
    const setup = await makeStore();
    await setup.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    const store = await makeStore({
      afterPublish: () => {
        throw new Error("injected afterPublish");
      },
    });
    await expect(
      store.tasks.commit(TASK_ID, {
        expectedVersion: 1,
        changeKind: "progress",
        actor: actor(),
        mutate: (draft) => {
          draft.task.progress = 80;
        },
      }),
    ).rejects.toThrow("injected afterPublish");
    expect((await readTaskAggregate(dataDir, TASK_ID))?.task.progress).toBe(10);
    expect((await revisionsOf(setup)).length).toBe(1);
    await store.close();
    await setup.close();
  });
});

describe("readRevisions", () => {
  it("按 taskVersion 顺序返回且校验 checksum", async () => {
    const store = await makeStore();
    await store.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await store.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: actor(),
      mutate: (draft) => {
        draft.task.progress = 60;
      },
    });
    const lines = await revisionsOf(store);
    expect(lines.map((line) => line.taskVersion)).toEqual([1, 2]);
    for (const line of lines) {
      const { checksum, ...rest } = line;
      expect(checksumOf(rest)).toBe(checksum);
    }
    await store.close();
  });

  it("不存在的聚合返回 EntryNotFoundError", async () => {
    const store = await makeStore();
    await expect(store.tasks.readRevisions(TASK_ID, () => undefined)).rejects.toBeInstanceOf(EntryNotFoundError);
    await store.close();
  });
});

describe("canonical snapshot", () => {
  it("快照与 TaskAggregate 结构一致", async () => {
    const store = await makeStore();
    const aggregate = await store.tasks.createAggregate({
      taskId: TASK_ID,
      task: baseTask(),
      subtasks: [],
      assignments: [{ taskId: TASK_ID, memberId: MEMBER_ID, kind: "owner" }],
      actor: actor(),
    });
    const [line] = await revisionsOf(store);
    expect(canonicalJson(line!.snapshot)).toBe(
      canonicalJson({ task: aggregate.task, subtasks: aggregate.subtasks, assignments: aggregate.assignments }),
    );
    await store.close();
  });
});
