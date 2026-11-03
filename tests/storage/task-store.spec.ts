import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EntryNotFoundError,
  VersionConflictError,
  checksumOf,
  createTaskStore,
  readTaskAggregate,
} from "@ztask/server";
import type { TaskStore } from "@ztask/server";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "ztask-taskspec-"));
  await mkdir(path.join(dataDir, "tasks"), { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function baseTask() {
  return {
    folderId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
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

function actor() {
  return { kind: "admin" as const, memberId: null, name: "管理员" };
}

async function makeStore(overrides: Partial<ConstructorParameters<typeof createTaskStore>[0]> = {}): Promise<TaskStore> {
  return createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z"), ...overrides });
}

describe("createAggregate", () => {
  it("发布 taskVersion=1 的 current，并落一条 create revision", async () => {
    const store = await makeStore();
    const aggregate = await store.createAggregate({
      taskId: TASK_ID,
      task: baseTask(),
      subtasks: [],
      assignments: [{ taskId: TASK_ID, memberId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "owner" }],
      actor: actor(),
    });
    expect(aggregate.taskVersion).toBe(1);
    expect(aggregate.revisionTip?.changeKind).toBe("create");
    expect(aggregate.revisionTip?.taskVersion).toBe(1);

    const onDisk = await readTaskAggregate(dataDir, TASK_ID);
    expect(onDisk?.taskVersion).toBe(1);
    expect(onDisk?.task.description).toBe("任务树组件重构");

    const revFiles = await readdir(path.join(dataDir, "tasks", TASK_ID));
    expect(revFiles.sort()).toEqual(["current.json", "revisions.jsonl"]);
    const revRaw = await readFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl"), "utf8");
    const lines = revRaw.trim().split("\n");
    expect(lines.length).toBe(1);
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(line.changeKind).toBe("create");
    expect(line.taskVersion).toBe(1);
    expect((line.actor as Record<string, unknown>).kind).toBe("admin");
  });

  it("taskId 非法（路径穿越/非 UUID）直接拒绝", async () => {
    const store = await makeStore();
    await expect(store.createAggregate({ taskId: "../evil", task: baseTask(), subtasks: [], assignments: [], actor: actor() })).rejects.toThrow();
    await expect(readTaskAggregate(dataDir, "../evil")).rejects.toThrow();
  });

  it("重复创建同一聚合报错，不产生第二条 create", async () => {
    const store = await makeStore();
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await expect(
      store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() }),
    ).rejects.toThrow();
    const revRaw = await readFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl"), "utf8");
    expect(revRaw.trim().split("\n").length).toBe(1);
  });
});

describe("commit（乐观版本 + 队列内复查）", () => {
  it("版本匹配：mutation 生效，版本递增，current 与 revision 同步", async () => {
    const store = await makeStore();
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });

    const updated = await store.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: actor(),
      mutate: (draft) => {
        draft.task.progress = 70;
      },
    });
    expect(updated.taskVersion).toBe(2);
    expect(updated.task.progress).toBe(70);
    expect(updated.revisionTip?.changeKind).toBe("progress");

    const onDisk = await readTaskAggregate(dataDir, TASK_ID);
    expect(onDisk?.taskVersion).toBe(2);
    const revRaw = await readFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl"), "utf8");
    const lines = revRaw.trim().split("\n");
    expect(lines.length).toBe(2);
    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    const { checksum, ...rest } = second;
    expect(checksum).toBe(checksumOf(rest));
  });

  it("版本过期：抛 VersionConflictError 携带最新版本，历史不重复、current 不变", async () => {
    const store = await makeStore();
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await store.commit(TASK_ID, {
      expectedVersion: 1, changeKind: "progress", actor: actor(),
      mutate: (draft) => { draft.task.progress = 50; },
    });

    const revBefore = await readFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl"), "utf8");
    let conflict: VersionConflictError | undefined;
    try {
      await store.commit(TASK_ID, {
        expectedVersion: 1, changeKind: "progress", actor: actor(),
        mutate: (draft) => { draft.task.progress = 99; },
      });
    } catch (cause) {
      conflict = cause as VersionConflictError;
    }
    expect(conflict).toBeInstanceOf(VersionConflictError);
    expect(conflict?.latestTaskVersion).toBe(2);

    expect(await readFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl"), "utf8")).toBe(revBefore);
    expect((await readTaskAggregate(dataDir, TASK_ID))?.task.progress).toBe(50);
  });

  it("并发提交同聚合：只有一个成功", async () => {
    const store = await makeStore();
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    const results = await Promise.allSettled([
      store.commit(TASK_ID, { expectedVersion: 1, changeKind: "progress", actor: actor(), mutate: (d) => { d.task.progress = 30; } }),
      store.commit(TASK_ID, { expectedVersion: 1, changeKind: "progress", actor: actor(), mutate: (d) => { d.task.progress = 60; } }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected[0]?.reason).toBeInstanceOf(VersionConflictError);
    const final = await readTaskAggregate(dataDir, TASK_ID);
    expect(final?.taskVersion).toBe(2);
    const revRaw = await readFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl"), "utf8");
    expect(revRaw.trim().split("\n").length).toBe(2);
  });

  it("mutate 校验失败不写任何文件", async () => {
    const store = await makeStore();
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    const before = await readTaskAggregate(dataDir, TASK_ID);
    await expect(
      store.commit(TASK_ID, {
        expectedVersion: 1, changeKind: "update", actor: actor(),
        mutate: () => { throw new Error("校验失败"); },
      }),
    ).rejects.toThrow("校验失败");
    expect(await readTaskAggregate(dataDir, TASK_ID)).toEqual(before);
    const revRaw = await readFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl"), "utf8");
    expect(revRaw.trim().split("\n").length).toBe(1);
  });
});

describe("fault injection（故障注入缝）", () => {
  it("afterAppend 注入失败：current 保持旧状态（append 已 fsync）", async () => {
    let failNextAppend = false;
    const store = await makeStore({
      hooks: {
        afterAppend: () => {
          if (failNextAppend) throw new Error("injected-after-append");
        },
      },
    });
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    failNextAppend = true;
    await expect(
      store.commit(TASK_ID, { expectedVersion: 1, changeKind: "progress", actor: actor(), mutate: (d) => { d.task.progress = 80; } }),
    ).rejects.toThrow("injected-after-append");
    const onDisk = await readTaskAggregate(dataDir, TASK_ID);
    expect(onDisk?.taskVersion).toBe(1);
    expect(onDisk?.task.progress).toBe(10);
  });

  it("afterPublish 注入失败：current 已是新状态（恢复责任在启动重建）", async () => {
    let failNextPublish = false;
    const store = await makeStore({
      hooks: {
        afterPublish: () => {
          if (failNextPublish) throw new Error("injected-after-publish");
        },
      },
    });
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    failNextPublish = true;
    await expect(
      store.commit(TASK_ID, { expectedVersion: 1, changeKind: "progress", actor: actor(), mutate: (d) => { d.task.progress = 90; } }),
    ).rejects.toThrow("injected-after-publish");
    expect((await readTaskAggregate(dataDir, TASK_ID))?.task.progress).toBe(90);
  });
});

describe("readRevisions", () => {
  it("按顺序流出全部 revision（含 checksum 校验）", async () => {
    const store = await makeStore();
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await store.commit(TASK_ID, { expectedVersion: 1, changeKind: "detail", actor: actor(), mutate: (d) => { d.task.detailText = "新详情"; } });
    const versions: number[] = [];
    const kinds: string[] = [];
    await store.readRevisions(TASK_ID, (record) => {
      versions.push(record.taskVersion as number);
      kinds.push(record.changeKind as string);
    });
    expect(versions).toEqual([1, 2]);
    expect(kinds).toEqual(["create", "detail"]);
  });

  it("聚合不存在时 readRevisions 抛 EntryNotFoundError", async () => {
    const store = await makeStore();
    await expect(store.readRevisions("22222222-2222-4222-8222-222222222222", () => undefined)).rejects.toBeInstanceOf(
      EntryNotFoundError,
    );
  });
});
