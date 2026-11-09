// @vitest-environment node
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBackupService,
  initStore,
  restoreFromBackup,
  RestoreError,
  SCHEMA_VERSION,
  type BackupResult,
  type ZtaskStore,
} from "@ztask/server";
import {
  APP_VERSION,
  FOLDER_CHILD_ID,
  FOLDER_ROOT_ID,
  MEMBER_B_ID,
  TASK_ID,
  TIME_ZONE,
  adminActor,
  makeTempDir,
  seedDataDir,
  steppingClock,
} from "./support/fixtures.js";

/**
 * 备份 → 新目录恢复（#23 / 06 §8 / 07 §9）：
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

async function stageLeftovers(parent: string): Promise<string[]> {
  return (await readdir(parent)).filter((name) => name.startsWith(".ztask-restore-"));
}

async function revisionCount(dataDir: string): Promise<number> {
  const store = await initStore({ dataDir, applicationVersion: APP_VERSION });
  try {
    let count = 0;
    await store.tasks.readRevisions(TASK_ID, () => {
      count += 1;
    });
    return count;
  } finally {
    await store.close();
  }
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
    expect(summary.manifest).toMatchObject({ formatVersion: SCHEMA_VERSION, timeZone: TIME_ZONE });
    expect(summary.files).toBeGreaterThanOrEqual(1);
    expect(summary.bytes).toBeGreaterThanOrEqual(backup.report.bytes);

    await expect(stat(path.join(targetDir, "backup.json"))).rejects.toThrow();
    expect(await stageLeftovers(dataDir)).toEqual([]);
    await expect(stat(path.join(targetDir, "ztask.db"))).resolves.toBeTruthy();
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

    const committed = await restored.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: adminActor(),
      mutate: (draft) => {
        draft.task.progress = 55;
      },
    });
    expect(committed.taskVersion).toBe(2);
    expect(committed.task.progress).toBe(55);
    expect(await revisionCount(targetDir)).toBe(2);
    await restored.close();
    await original.close();
  });

  it("目标已存在但为空：允许覆盖并完成恢复", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);

    const targetDir = path.join(dataDir, "empty-target");
    await mkdir(targetDir, { recursive: true });
    const summary = await restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION });
    expect(summary.tasks).toBe(1);
    await expect(stat(path.join(targetDir, "ztask.db"))).resolves.toBeTruthy();
    expect(await stageLeftovers(dataDir)).toEqual([]);
  });
});

describe("恢复拒绝", () => {
  it("损坏的 ztask.db：拒绝恢复且不留半目录，备份不被改写", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);

    const dbFile = path.join(backup.backupDir, "ztask.db");
    await writeFile(dbFile, "not a sqlite database", "utf8");
    const sizeBefore = (await stat(dbFile)).size;

    const targetDir = path.join(dataDir, "restored");
    const error = await restoreFromBackup({ backupDir: backup.backupDir, targetDir, applicationVersion: APP_VERSION })
      .then(() => null)
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(RestoreError);
    expect((error as RestoreError).code).toBe("RESTORE_BACKUP_INVALID");
    expect((error as RestoreError).issues.length).toBeGreaterThan(0);
    await expect(stat(targetDir)).rejects.toThrow();
    expect(await stageLeftovers(dataDir)).toEqual([]);
    expect((await stat(dbFile)).size).toBe(sizeBefore);
  });

  it("备份缺 ztask.db：拒绝恢复", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const backup = await backupOf(dataDir, store);
    await rm(path.join(backup.backupDir, "ztask.db"));

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
