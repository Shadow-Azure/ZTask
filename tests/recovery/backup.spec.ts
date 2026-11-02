// @vitest-environment node
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildApp,
  createBackupService,
  listDataDirFiles,
  taskCurrentPath,
  taskRevisionsPath,
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
 * 在线备份（#23 / 06 §10 / 07 §9）：
 * 暂停写入的一致快照、排除项、报告字段、原子发布失败不留半备份、管理端 409/403。
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

/** JSONL 有效行数（半行/空文件都按现状统计）。 */
async function lineCount(file: string): Promise<number> {
  try {
    return (await readFile(file, "utf8")).split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    return 0;
  }
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

    const revisionsFile = taskRevisionsPath(dataDir, TASK_ID);
    const writePromise = store.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: adminActor(),
      mutate: (draft) => {
        draft.task.progress = 90;
      },
    });
    // 暂停期内提交：写请求必须停在闸门前，不能进入复制快照。
    const outcome = await Promise.race([
      writePromise.then(() => "written" as const),
      delay(60).then(() => "blocked" as const),
    ]);
    expect(outcome).toBe("blocked");
    expect(await lineCount(revisionsFile)).toBe(1);

    release.resolve();
    const result = await backupPromise;
    const written = await writePromise;
    expect(written.taskVersion).toBe(2);
    expect(written.task.progress).toBe(90);
    expect(service.isRunning()).toBe(false);

    const backupCurrent = JSON.parse(
      await readFile(path.join(result.backupDir, "tasks", TASK_ID, "current.json"), "utf8"),
    ) as { taskVersion: number; task: { progress: number } };
    expect(backupCurrent.taskVersion).toBe(1);
    expect(backupCurrent.task.progress).toBe(20);
    expect(await lineCount(path.join(result.backupDir, "tasks", TASK_ID, "revisions.jsonl"))).toBe(1);
    expect(await lineCount(revisionsFile)).toBe(2);
  });

  it("快照排除 locks/tmp/backups 与原子写、尾部恢复中间文件", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await writeFile(path.join(dataDir, "locks", ".ztask-lock"), "stale-lock", "utf8");
    await writeFile(path.join(dataDir, "tmp", "leftover.txt"), "leftover", "utf8");
    await mkdir(path.join(dataDir, "backups", "previous"), { recursive: true });
    await writeFile(path.join(dataDir, "backups", "previous", "backup.json"), "{}", "utf8");
    await writeFile(path.join(dataDir, "tasks", TASK_ID, ".ztask-tmp-abc"), "partial", "utf8");
    await writeFile(path.join(dataDir, "tasks", TASK_ID, "revisions.jsonl.corrupt-20260101"), "junk", "utf8");

    const result = await serviceFor(store, dataDir).create();
    const files = (await listDataDirFiles(result.backupDir)).map((file) => file.path);

    expect(files).toContain("manifest.json");
    expect(files).toContain(`tasks/${TASK_ID}/current.json`);
    expect(files).toContain(`members/${"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}.json`);
    expect(files.some((entry) => /^(locks|tmp|backups)\//.test(entry))).toBe(false);
    expect(files.some((entry) => entry.includes(".ztask-tmp-") || entry.includes(".corrupt-"))).toBe(false);
    await expect(stat(path.join(result.backupDir, "locks"))).rejects.toThrow();
    // 报告的文件数就是快照里实际的数据文件数（不含 backup.json 自身）。
    expect(result.report.files).toBe(files.length);
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
    });
    expect(result.report.files).toBeGreaterThan(0);
    expect(result.report.bytes).toBeGreaterThan(0);
    // 快照里必须包含 manifest 与任务聚合（可用作恢复源）。
    await expect(stat(path.join(result.backupDir, "manifest.json"))).resolves.toBeTruthy();
    await expect(stat(path.join(result.backupDir, "tasks", TASK_ID, "revisions.jsonl"))).resolves.toBeTruthy();
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

    // 失败路径必须 resume：写队列仍可正常工作。
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

  it("校验未通过：拒绝发布，备份目录保持为空", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await writeFile(taskCurrentPath(dataDir, TASK_ID), "{ not-json", "utf8");

    await expect(serviceFor(store, dataDir).create()).rejects.toThrow(/校验未通过/);
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

      // LAN listener 上 Admin 守卫优先：备份端点同样 403，不会触发备份。
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
