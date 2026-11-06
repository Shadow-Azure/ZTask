import { appendFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonlLine,
  checksumOf,
  initStore,
  readTaskAggregate,
  taskCurrentPath,
  taskRevisionsPath,
  writeJsonAtomic,
} from "@ztask/server";
import type { TaskAggregate } from "@ztask/server";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const FOLDER_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const MEMBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

async function seedLegacyBase(): Promise<void> {
  await mkdir(path.join(dataDir, "members"), { recursive: true });
  await mkdir(path.join(dataDir, "folders"), { recursive: true });
  await writeJsonAtomic(path.join(dataDir, "manifest.json"), {
    formatVersion: 1,
    applicationVersion: "0.1.0",
    createdAt: "2026-11-01T00:00:00.000Z",
    timeZone: "Asia/Shanghai",
  });
  await writeJsonAtomic(path.join(dataDir, "members", `${MEMBER_ID}.json`), {
    formatVersion: 1,
    id: MEMBER_ID,
    name: "陈晨",
    role: "前端工程师",
    color: "#2f6fe0",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    archivedAt: null,
  });
  await writeJsonAtomic(path.join(dataDir, "folders", `${FOLDER_ID}.json`), {
    formatVersion: 1,
    id: FOLDER_ID,
    parentId: null,
    name: "任务夹",
    position: 0,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    deletedAt: null,
  });
  await mkdir(path.join(dataDir, "tasks", TASK_ID), { recursive: true });
}

function revisionV1() {
  return {
    formatVersion: 1,
    revisionId: "r-1",
    taskId: TASK_ID,
    taskVersion: 1,
    recordedAt: "2026-11-02T03:00:00.000Z",
    changeKind: "create" as const,
    actor: actor(),
    snapshot: { task: baseTask(), subtasks: [], assignments: [] },
  };
}

function currentV1(): TaskAggregate {
  const revision = revisionV1();
  return {
    formatVersion: 1,
    taskId: TASK_ID,
    taskVersion: 1,
    updatedAt: revision.recordedAt,
    revisionTip: {
      taskVersion: 1,
      recordedAt: revision.recordedAt,
      changeKind: "create",
      checksum: checksumOf(revision),
    },
    task: baseTask(),
    subtasks: [],
    assignments: [],
  };
}

describe("SQLite 重启", () => {
  it("重启后任务可继续提交", async () => {
    const first = await initStore({ dataDir, applicationVersion: "0.1.0" });
    await first.folders.put(FOLDER_ID, { id: FOLDER_ID, parentId: null, name: "任务夹", position: 0 });
    await first.tasks.createAggregate({ taskId: TASK_ID, task: baseTask(), subtasks: [], assignments: [], actor: actor() });
    await first.drain();
    await first.close();

    const second = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const aggregate = await second.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: actor(),
      mutate: (draft) => {
        draft.task.progress = 40;
      },
    });
    expect(aggregate.taskVersion).toBe(2);
    await second.close();
  });
});

describe("旧文件导入", () => {
  it("current 落后时用最新 revision 快照重建，并移走旧文件", async () => {
    await seedLegacyBase();
    const v1 = revisionV1();
    await appendJsonlLine(taskRevisionsPath(dataDir, TASK_ID), v1);
    await writeJsonAtomic(taskCurrentPath(dataDir, TASK_ID), currentV1());
    const v2 = {
      ...v1,
      revisionId: "r-2",
      taskVersion: 2,
      recordedAt: "2026-11-02T04:00:00.000Z",
      changeKind: "progress" as const,
      snapshot: { task: baseTask(70), subtasks: [], assignments: [] },
    };
    await appendJsonlLine(taskRevisionsPath(dataDir, TASK_ID), v2);

    const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const rebuilt = await readTaskAggregate(dataDir, TASK_ID);
    expect(rebuilt?.taskVersion).toBe(2);
    expect(rebuilt?.task.progress).toBe(70);
    expect(rebuilt?.revisionTip.checksum).toBe(checksumOf(v2));
    expect(existsSync(path.join(dataDir, "manifest.json"))).toBe(false);
    expect(existsSync(path.join(dataDir, "ztask.db"))).toBe(true);
    const backups = await readdir(path.join(dataDir, "backups"));
    expect(backups.some((name) => name.startsWith("pre-sqlite-"))).toBe(true);
    await store.close();
  });

  it("current 缺失而 revision 存在：用 revision 重建", async () => {
    await seedLegacyBase();
    await appendJsonlLine(taskRevisionsPath(dataDir, TASK_ID), revisionV1());
    const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
    const rebuilt = await readTaskAggregate(dataDir, TASK_ID);
    expect(rebuilt?.taskVersion).toBe(1);
    expect(rebuilt?.task.progress).toBe(10);
    await store.close();
  });

  it("revisionTip checksum 不一致：拒绝导入，旧文件保留且不留下半库", async () => {
    await seedLegacyBase();
    await appendJsonlLine(taskRevisionsPath(dataDir, TASK_ID), revisionV1());
    const current = currentV1();
    await writeJsonAtomic(taskCurrentPath(dataDir, TASK_ID), {
      ...current,
      revisionTip: { ...current.revisionTip, checksum: "deadbeef" },
    });

    await expect(initStore({ dataDir, applicationVersion: "0.1.0" })).rejects.toThrow();
    expect(existsSync(path.join(dataDir, "ztask.db"))).toBe(false);
    expect(existsSync(path.join(dataDir, "manifest.json"))).toBe(true);
  });

  it("JSONL 半行尾部：先备份再截断，导入有效前缀", async () => {
    await seedLegacyBase();
    await appendJsonlLine(taskRevisionsPath(dataDir, TASK_ID), revisionV1());
    await appendFile(taskRevisionsPath(dataDir, TASK_ID), '{"taskId":"t","taskVer', "utf8");

    const store = await initStore({ dataDir, applicationVersion: "0.1.0" });
    expect((await readTaskAggregate(dataDir, TASK_ID))?.taskVersion).toBe(1);
    await store.close();
  });

  it("损坏的 revision checksum：拒绝导入", async () => {
    await seedLegacyBase();
    const revision = revisionV1();
    const line = { ...revision, checksum: "deadbeef" };
    await writeFile(taskRevisionsPath(dataDir, TASK_ID), `${JSON.stringify(line)}\n`, "utf8");
    await writeJsonAtomic(taskCurrentPath(dataDir, TASK_ID), currentV1());
    await expect(initStore({ dataDir, applicationVersion: "0.1.0" })).rejects.toThrow();
    expect(existsSync(path.join(dataDir, "ztask.db"))).toBe(false);
  });
});
