// @vitest-environment node
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBackupService,
  initStore,
  restoreFromBackup,
  RestoreError,
  taskCurrentPath,
  taskRevisionsPath,
  type BackupResult,
  type ZtaskStore,
} from "@ztask/server";
import {
  APP_VERSION,
  FOLDER_CHILD_ID,
  FOLDER_ROOT_ID,
  MEMBER_B_ID,
  SUBTASK_ID,
  TASK_ID,
  TIME_ZONE,
  adminActor,
  makeTempDir,
  seedDataDir,
  steppingClock,
} from "./support/fixtures.js";

/**
 * 备份 → 新目录恢复（#23 / 06 §10 / 07 §9）：
 * 恢复后 initStore 成功且 tasks/folders/members/indexes 等价；损坏备份与非法目标被拒绝，
 * 且失败不留下半恢复目录。
 */

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newDataDir(): Promise<string> {
  const dir = await makeTempDir("ztask-restore");
  createdDirs.push(dir);
  return dir;
}

/** 对一个已 seed 的数据目录做一次真实在线备份。 */
async function backupOf(dataDir: string, store: ZtaskStore): Promise<BackupResult> {
  const service = createBackupService({
    dataDir,
    appVersion: APP_VERSION,
    timeZone: TIME_ZONE,
    clock: steppingClock("2026-11-02T07:00:00.000Z"),
    pauseWrites: () => store.pauseWrites(),
  });
  return service.create();
}

/** 目标目录同级是否残留 `.ztask-restore-*` 临时目录。 */
async function stageLeftovers(parent: string): Promise<string[]> {
  return (await readdir(parent)).filter((name) => name.startsWith(".ztask-restore-"));
}

describe("恢复等价性", () => {
  it("恢复出的新目录可直接 initStore，聚合/实体/派生索引与源目录等价且可继续写", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);

    const targetDir = path.join(dataDir, "restored");
    const summary = await restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION });
    expect(summary).toMatchObject({
      backupDir: backup.backupDir,
      targetDir,
      tasks: 1,
      folders: 2,
      members: 2,
      repaired: false,
    });
    expect(summary.manifest).toMatchObject({ formatVersion: 1, timeZone: TIME_ZONE });
    expect(summary.files).toBe(backup.report.files);
    expect(summary.bytes).toBe(backup.report.bytes);

    // 恢复目录是"新建的数据目录"：无备份报告、无临时目录、布局齐全。
    await expect(stat(path.join(targetDir, "backup.json"))).rejects.toThrow();
    expect(await stageLeftovers(dataDir)).toEqual([]);
    await expect(stat(path.join(targetDir, "manifest.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(targetDir, "backups"))).resolves.toBeTruthy();

    const restored = await initStore({ dataDir: targetDir, applicationVersion: APP_VERSION });
    const original = await initStore({ dataDir, applicationVersion: APP_VERSION });

    expect([...restored.indexes.byId.keys()]).toEqual([...original.indexes.byId.keys()]);
    expect(restored.indexes.byId.get(TASK_ID)).toEqual(original.indexes.byId.get(TASK_ID));
    expect(restored.indexes.folderChildren.get(null)).toEqual(original.indexes.folderChildren.get(null));
    expect(restored.indexes.folderChildren.get(FOLDER_ROOT_ID)).toEqual(
      original.indexes.folderChildren.get(FOLDER_ROOT_ID),
    );
    expect(restored.indexes.activeTasksByFolder.get(FOLDER_CHILD_ID)).toEqual(
      original.indexes.activeTasksByFolder.get(FOLDER_CHILD_ID),
    );
    expect(restored.indexes.historyTasksByFolder.get(FOLDER_CHILD_ID)).toEqual(
      original.indexes.historyTasksByFolder.get(FOLDER_CHILD_ID),
    );
    expect(restored.indexes.assignmentsByMember.get(MEMBER_B_ID)).toEqual(
      original.indexes.assignmentsByMember.get(MEMBER_B_ID),
    );
    expect(restored.indexes.activeOwnersByTask.get(TASK_ID)).toEqual(
      original.indexes.activeOwnersByTask.get(TASK_ID),
    );
    expect(await restored.folders.list()).toEqual(await original.folders.list());
    expect(await restored.members.list()).toEqual(await original.members.list());

    // 恢复后的目录可以继续提交（revision 与 current 同步推进）。
    const committed = await restored.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: adminActor(),
      mutate: (draft) => {
        draft.task.progress = 55;
        draft.subtasks[0]!.progress = 30;
      },
    });
    expect(committed.taskVersion).toBe(2);
    expect(committed.task.progress).toBe(55);
    expect(committed.subtasks[0]!.id).toBe(SUBTASK_ID);
    const lines = (await readFile(taskRevisionsPath(targetDir, TASK_ID), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("目标已存在但为空：允许覆盖并完成恢复", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);

    const targetDir = path.join(dataDir, "empty-target");
    await mkdir(targetDir, { recursive: true });
    const summary = await restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION });
    expect(summary.tasks).toBe(1);
    await expect(stat(path.join(targetDir, "tasks", TASK_ID, "current.json"))).resolves.toBeTruthy();
    expect(await stageLeftovers(dataDir)).toEqual([]);
  });
});

describe("恢复拒绝", () => {
  it("损坏备份（中间/整体 checksum 损坏）：拒绝恢复且不留半目录", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);

    const revisionsFile = path.join(backup.backupDir, "tasks", TASK_ID, "revisions.jsonl");
    const raw = await readFile(revisionsFile, "utf8");
    await writeFile(
      revisionsFile,
      raw.replace(/"checksum":"[0-9a-f]{64}"/, `"checksum":"${"0".repeat(64)}"`),
      "utf8",
    );

    const targetDir = path.join(dataDir, "restored");
    const error = await restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION })
      .then(() => null)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(RestoreError);
    expect((error as RestoreError).code).toBe("RESTORE_BACKUP_INVALID");
    expect((error as RestoreError).issues.length).toBeGreaterThan(0);
    await expect(stat(targetDir)).rejects.toThrow();
    expect(await stageLeftovers(dataDir)).toEqual([]);
    // 备份本身不被改写。
    expect((await readFile(revisionsFile, "utf8")).length).toBe(raw.length);
  });

  it("备份缺 manifest：拒绝恢复", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);
    await rm(path.join(backup.backupDir, "manifest.json"));

    const targetDir = path.join(dataDir, "restored");
    await expect(
      restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION }),
    ).rejects.toMatchObject({ code: "RESTORE_BACKUP_INVALID" });
    await expect(stat(targetDir)).rejects.toThrow();
    expect(await stageLeftovers(dataDir)).toEqual([]);
  });

  it("目标非空：拒绝且不触碰已有文件、不留半目录", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);

    const targetDir = path.join(dataDir, "restored");
    await mkdir(targetDir, { recursive: true });
    await writeFile(path.join(targetDir, "keep.txt"), "keep-me", "utf8");

    const error = await restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION })
      .then(() => null)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RestoreError);
    expect((error as RestoreError).code).toBe("RESTORE_TARGET_NOT_EMPTY");
    expect(await readFile(path.join(targetDir, "keep.txt"), "utf8")).toBe("keep-me");
    expect(await readdir(targetDir)).toEqual(["keep.txt"]);
    expect(await stageLeftovers(dataDir)).toEqual([]);
  });

  it("目标与备份互相包含：拒绝", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);

    await expect(
      restoreFromBackup({ backupDir: backup.backupDir, targetDir: backup.backupDir, applicationVersion: APP_VERSION }),
    ).rejects.toMatchObject({ code: "RESTORE_TARGET_INVALID" });
    await expect(
      restoreFromBackup({
        backupDir: backup.backupDir,
        targetDir: path.join(backup.backupDir, "inside"),
        applicationVersion: APP_VERSION,
      }),
    ).rejects.toMatchObject({ code: "RESTORE_TARGET_INVALID" });
    await expect(stat(path.join(backup.backupDir, "inside"))).rejects.toThrow();
  });
});

describe("恢复后的启动装配", () => {
  it("备份含可自动修复的 JSONL 尾部：恢复时由启动恢复处理并标记 repaired", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);
    // 手工往备份里追加半行（模拟备份发布后被人为写坏尾部；备份服务本身不会发布这种快照）。
    const revisionsFile = path.join(backup.backupDir, "tasks", TASK_ID, "revisions.jsonl");
    await writeFile(revisionsFile, `${await readFile(revisionsFile, "utf8")}{"taskVersion":2`, "utf8");

    const targetDir = path.join(dataDir, "restored");
    const summary = await restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION });
    expect(summary.repaired).toBe(true);
    const restored = await initStore({ dataDir: targetDir, applicationVersion: APP_VERSION });
    expect(restored.manifest.formatVersion).toBe(1);
    const lines = (await readFile(taskRevisionsPath(targetDir, TASK_ID), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    // 尾部修复前会先保住原文件（同名 .corrupt-* 副本），不静默丢弃字节。
    const taskDirEntries = await readdir(path.join(targetDir, "tasks", TASK_ID));
    expect(taskDirEntries.some((name) => name.startsWith("revisions.jsonl.corrupt-"))).toBe(true);
    // current 仍与唯一完整 revision 一致。
    expect((await stat(taskCurrentPath(targetDir, TASK_ID))).size).toBeGreaterThan(0);
  });
});
