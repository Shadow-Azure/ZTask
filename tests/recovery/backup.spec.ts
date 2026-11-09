// @vitest-environment node
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildApp,
  createBackupService,
  createTaskStore,
  readTaskAggregate,
  listDataDirFiles,
  SCHEMA_VERSION,
  type BackupHooks,
  type BackupResult,
  type BackupService,
  type ServerConfig,
  type ZtaskStore,
} from "@ztask/server";
import {
  APP_VERSION,
  TASK_ID,
  TIME_ZONE,
  adminActor,
  deferred,
  delay,
  makeTempDir,
  seedDataDir,
  steppingClock,
} from "./support/fixtures.js";

/**
 * 在线备份（#23 / 06 §8 / 07 §9）：
 * SQLite `VACUUM INTO` 一致性快照、暂停写入、排除项、报告字段、原子发布失败不留半备份、管理端 409/403。
 */

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newDataDir(): Promise<string> {
  const dir = await makeTempDir("ztask-backup");
  createdDirs.push(dir);
  return dir;
}

function serviceFor(
  store: ZtaskStore,
  dataDir: string,
  options: { clock?: () => Date; hooks?: BackupHooks } = {},
): BackupService {
  return createBackupService({
    dataDir,
    appVersion: APP_VERSION,
    timeZone: TIME_ZONE,
    clock: options.clock ?? steppingClock("2026-11-02T05:00:00.000Z"),
    pauseWrites: () => store.pauseWrites(),
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
}

async function aggregateIn(dataDir: string) {
  return await readTaskAggregate(dataDir, TASK_ID);
}

async function revisionCount(dataDir: string): Promise<number> {
  let count = 0;
  await createTaskStore({ dataDir }).readRevisions(TASK_ID, () => {
    count += 1;
  });
  return count;
}

describe("在线备份的一致性边界", () => {
  it("备份窗口内暂停写入：并发提交不进入快照，恢复后正常落盘", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);

    const entered = deferred<void>();
    const release = deferred<void>();
    const service = serviceFor(store, dataDir, {
      hooks: {
        beforePublish: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    });

    const backupPromise = service.create();
    await entered.promise;
    expect(service.isRunning()).toBe(true);

    const writePromise = store.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: adminActor(),
      mutate: (draft) => {
        draft.task.progress = 90;
      },
    });
    const outcome = await Promise.race([
      writePromise.then(() => "written" as const),
      delay(60).then(() => "blocked" as const),
    ]);
    expect(outcome).toBe("blocked");
    expect(await revisionCount(dataDir)).toBe(1);

    release.resolve();
    const result = await backupPromise;
    const written = await writePromise;
    expect(written.taskVersion).toBe(2);
    expect(written.task.progress).toBe(90);
    expect(service.isRunning()).toBe(false);

    const backupAggregate = await aggregateIn(result.backupDir);
    expect(backupAggregate?.taskVersion).toBe(1);
    expect(backupAggregate?.task.progress).toBe(20);
    expect(await revisionCount(result.backupDir)).toBe(1);
    expect(await revisionCount(dataDir)).toBe(2);
  });

  it("快照只含 ztask.db 与报告，不复制 locks/tmp/backups", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await writeFile(path.join(dataDir, "locks", ".ztask-lock"), "stale-lock", "utf8");
    await writeFile(path.join(dataDir, "tmp", "leftover.txt"), "leftover", "utf8");
    await mkdir(path.join(dataDir, "backups", "previous"), { recursive: true });
    await writeFile(path.join(dataDir, "backups", "previous", "backup.json"), "{}", "utf8");

    const result = await serviceFor(store, dataDir).create();
    const files = (await listDataDirFiles(result.backupDir)).map((file) => file.path);

    expect(files).toEqual(["ztask.db"]);
    expect(files.some((entry) => /^(locks|tmp|backups)\//.test(entry))).toBe(false);
    await expect(stat(path.join(result.backupDir, "backup.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(result.backupDir, "locks"))).rejects.toThrow();
    expect(result.report.files).toBe(1);
  });

  it("报告字段齐全、目录名带 UTC 时间戳、backup.json 与返回报告一致", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const fixed = new Date("2026-11-02T03:04:05.678Z");

    const result = await serviceFor(store, dataDir, { clock: () => fixed }).create();
    const dirName = path.basename(result.backupDir);
    expect(dirName).toMatch(/^2026-11-02T03-04-05-678Z-[0-9a-f-]{36}$/);
    expect(path.dirname(result.backupDir)).toBe(path.join(dataDir, "backups"));

    const onDisk = JSON.parse(await readFile(path.join(result.backupDir, "backup.json"), "utf8"));
    expect(onDisk).toEqual(result.report);
    expect(result.report).toMatchObject({
      formatVersion: 1,
      appVersion: APP_VERSION,
      createdAt: fixed.toISOString(),
      timeZone: TIME_ZONE,
      dataDir,
      excluded: ["locks", "tmp", "backups", ".ztask-lock"],
      validation: { ok: true, issues: [] },
      schemaVersion: SCHEMA_VERSION,
    });
    expect(result.report.files).toBe(1);
    expect(result.report.bytes).toBeGreaterThan(0);
    expect(result.report.tables?.task_revisions).toBeGreaterThanOrEqual(1);
    await expect(stat(path.join(result.backupDir, "ztask.db"))).resolves.toBeTruthy();
  });
});

describe("原子发布与失败清理", () => {
  it("发布前失败：不产生半备份、不残留临时目录，且写入已恢复", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const service = serviceFor(store, dataDir, {
      hooks: {
        beforePublish: () => {
          throw new Error("模拟发布前崩溃");
        },
      },
    });

    await expect(service.create()).rejects.toThrow("模拟发布前崩溃");
    expect(await readdir(path.join(dataDir, "backups"))).toEqual([]);
    const tmpLeftovers = (await readdir(path.join(dataDir, "tmp"))).filter((name) => name.startsWith("backup-"));
    expect(tmpLeftovers).toEqual([]);
    expect(service.isRunning()).toBe(false);

    const committed = await store.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "detail",
      actor: adminActor(),
      mutate: (draft) => {
        draft.task.detailText = "发布失败后仍可写";
      },
    });
    expect(committed.taskVersion).toBe(2);
  });

  it("数据库不可打开：拒绝发布，备份目录保持为空", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await store.close();
    await writeFile(path.join(dataDir, "ztask.db"), "not a sqlite database", "utf8");

    await expect(serviceFor(store, dataDir).create()).rejects.toThrow();
    expect(await readdir(path.join(dataDir, "backups"))).toEqual([]);
  });
});

describe("管理端备份端点", () => {
  it("201 返回备份目录与报告；进行中再次请求 409 BACKUP_IN_PROGRESS；LAN 入口 403", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    const config: ServerConfig = { host: "127.0.0.1", port: 0, dataDir, staticRoot: null };

    const entered = deferred<void>();
    const release = deferred<void>();
    const app = await buildApp(config, {
      store,
      version: APP_VERSION,
      clock: steppingClock(),
      backupHooks: {
        beforePublish: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    });

    try {
      const first = app.inject({ method: "POST", url: "/api/v1/admin/maintenance/backup" });
      await entered.promise;

      const second = await app.inject({ method: "POST", url: "/api/v1/admin/maintenance/backup" });
      expect(second.statusCode).toBe(409);
      expect((second.json() as { error: { code: string } }).error.code).toBe("BACKUP_IN_PROGRESS");

      release.resolve();
      const response = await first;
      expect(response.statusCode).toBe(201);
      const body = response.json() as BackupResult;
      expect(body.report.validation.ok).toBe(true);
      expect(path.dirname(body.backupDir)).toBe(path.join(dataDir, "backups"));
      expect(path.basename(body.backupDir)).toMatch(/^[0-9T:.-]+Z-[0-9a-f-]{36}$/);
      await expect(stat(path.join(body.backupDir, "backup.json"))).resolves.toBeTruthy();
      await expect(stat(path.join(body.backupDir, "ztask.db"))).resolves.toBeTruthy();

      const lanApp = await buildApp(config, { store, version: APP_VERSION, listenerKind: "lan" });
      try {
        const denied = await lanApp.inject({ method: "POST", url: "/api/v1/admin/maintenance/backup" });
        expect(denied.statusCode).toBe(403);
        expect((denied.json() as { error: { code: string } }).error.code).toBe("ADMIN_LOCAL_ONLY");
      } finally {
        await lanApp.close();
      }
    } finally {
      await app.close();
    }
  });
});
