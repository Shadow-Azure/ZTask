import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonlLine,
  checksumOf,
  createTaskStore,
  initStore,
  readJsonFile,
  readTaskAggregate,
  taskCurrentPath,
  taskRevisionsPath,
  writeJsonAtomic,
} from "@ztask/server";
import type { TaskAggregate } from "@ztask/server";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

let dataDir: string;

beforeEach(async () => {
  dataDir = path.join("/tmp", `ztask-recovery-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dataDir, { recursive: true });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function baseTask(progress = 10) {
  return {
    folderId: FOLDER_ID,
    parentId: null,
    description: "恢复场景任务",
    progress,
    detailText: "detail",
    importance: "high" as const,
    dueDate: null,
    createdAt: "2026-11-01T01:00:00.000Z",
    deletedAt: null,
  };
}

function actor() {
  return { kind: "admin" as const, memberId: null, name: "管理员" };
}

describe("initStore 启动恢复", () => {
  it("健康目录：直接可用，任务可继续提交", async () => {
    const first = await initStore({ dataDir, applicationVersion: "0.1.0" });
    await first.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await first.drain();
    const second = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const aggregate = await second.tasks.commit(TASK_ID, {
      expectedVersion: 1, changeKind: "progress", actor: actor(),
      mutate: (d) => { d.task.progress = 40; },
    });
    expect(aggregate.taskVersion).toBe(2);
  });

  it("current 落后于 revision tip（append 后崩溃）：从最新快照重建 current", async () => {
    const store = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    // 模拟"append 后、current 发布前"崩溃：直接追加 v2 revision，不更新 current。
    const snapshot = { task: { ...baseTask(70) }, subtasks: [], assignments: [] };
    await appendJsonlLine(taskRevisionsPath(dataDir, TASK_ID), {
      formatVersion: 1, revisionId: "r-2", taskId: TASK_ID, taskVersion: 2,
      recordedAt: "2026-11-02T04:00:00.000Z", changeKind: "progress", actor: actor(), snapshot,
    });

    await initStore({ dataDir, applicationVersion: "0.1.0" });
    const rebuilt = await readTaskAggregate(dataDir, TASK_ID);
    expect(rebuilt?.taskVersion).toBe(2);
    expect(rebuilt?.task.progress).toBe(70);
    expect(rebuilt?.revisionTip.taskVersion).toBe(2);
    expect(rebuilt?.revisionTip.checksum).toBe(checksumOf({
      formatVersion: 1, revisionId: "r-2", taskId: TASK_ID, taskVersion: 2,
      recordedAt: "2026-11-02T04:00:00.000Z", changeKind: "progress", actor: actor(), snapshot,
    }));
  });

  it("current 缺失而 revision 存在：同样重建", async () => {
    const store = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(33), subtasks: [], assignments: [], actor: actor() });
    const { rm } = await import("node:fs/promises");
    await rm(taskCurrentPath(dataDir, TASK_ID));

    await initStore({ dataDir, applicationVersion: "0.1.0" });
    const rebuilt = await readTaskAggregate(dataDir, TASK_ID);
    expect(rebuilt?.taskVersion).toBe(1);
    expect(rebuilt?.task.progress).toBe(33);
  });

  it("current 比 revision 新（tip 指向不存在的 revision）：拒绝自动修复", async () => {
    const store = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    // 伪造 current 落后一格的 tip 指向不存在的 v2
    const current = (await readJsonFile(taskCurrentPath(dataDir, TASK_ID))) as TaskAggregate;
    await writeJsonAtomic(taskCurrentPath(dataDir, TASK_ID), {
      ...current,
      taskVersion: 2,
      revisionTip: { ...current.revisionTip, taskVersion: 2 },
    });

    await expect(initStore({ dataDir, applicationVersion: "0.1.0" })).rejects.toThrow();
    // 文件未被"修复"
    expect((await readTaskAggregate(dataDir, TASK_ID))?.taskVersion).toBe(2);
  });

  it("revisionTip checksum 与 revision 不匹配：拒绝启动", async () => {
    const store = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    const current = (await readJsonFile(taskCurrentPath(dataDir, TASK_ID))) as TaskAggregate;
    await writeJsonAtomic(taskCurrentPath(dataDir, TASK_ID), {
      ...current,
      revisionTip: { ...current.revisionTip, checksum: "deadbeef" },
    });
    await expect(initStore({ dataDir, applicationVersion: "0.1.0" })).rejects.toThrow();
  });

  it("JSONL 半行尾部：启动恢复后任务可继续提交", async () => {
    const store = createTaskStore({ dataDir, clock: () => new Date("2026-11-02T03:00:00.000Z") });
    await store.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    const { appendFile } = await import("node:fs/promises");
    await appendFile(taskRevisionsPath(dataDir, TASK_ID), '{"taskId":"t","taskVer', "utf8");

    const boot = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const aggregate = await boot.tasks.commit(TASK_ID, {
      expectedVersion: 1, changeKind: "detail", actor: actor(),
      mutate: (d) => { d.task.detailText = "恢复后继续"; },
    });
    expect(aggregate.taskVersion).toBe(2);
    const revRaw = await readFile(taskRevisionsPath(dataDir, TASK_ID), "utf8");
    expect(revRaw.trim().split("\n").length).toBe(2);
  });
});
