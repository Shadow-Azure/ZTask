// @vitest-environment node
import { appendFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackupService, serve, taskRevisionsPath, validateServeConfig, type ServeHandle } from "@ztask/server";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  normalizeBaseUrl,
  parseCliArgs,
  runBackup,
  runDoctor,
  runRestore,
} from "@ztask/cli";
import { APP_VERSION, TASK_ID, TIME_ZONE, makeTempDir, seedDataDir, steppingClock } from "./support/fixtures.js";

/**
 * CLI 三个维护子命令（#23 / 07 §9）：参数解析、退出码语义与真实链路。
 * backup 走管理端 HTTP（此处对真实 serve 端口执行），restore/doctor 离线执行。
 */

const createdDirs: string[] = [];

beforeEach(() => {
  // CLI 面向人的输出在测试里没有价值，静音以免污染 vitest 报告。
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newDataDir(): Promise<string> {
  const dir = await makeTempDir("ztask-cli");
  createdDirs.push(dir);
  return dir;
}

describe("参数解析", () => {
  it("backup / restore / doctor 都解析为各自的命令，--help 列出四个子命令并正常退出", () => {
    expect(parseCliArgs(["backup"])).toEqual({ command: "backup", url: "http://127.0.0.1:8123" });
    expect(parseCliArgs(["backup", "--url", "http://127.0.0.1:9000"])).toEqual({
      command: "backup",
      url: "http://127.0.0.1:9000",
    });
    expect(parseCliArgs(["restore", "--backup", "/tmp/b", "--data-dir", "/tmp/d"])).toEqual({
      command: "restore",
      backupDir: "/tmp/b",
      dataDir: "/tmp/d",
    });
    expect(parseCliArgs(["doctor"])).toEqual({ command: "doctor" });
    expect(parseCliArgs(["doctor", "--data-dir", "/tmp/d"])).toEqual({ command: "doctor", dataDir: "/tmp/d" });

    // restore 的两个必填参数缺失 → commander 用法错误（cli.ts 映射为退出码 2）。
    expect(() => parseCliArgs(["restore", "--backup", "/tmp/b"])).toThrow();
    // --help 由 commander 抛 exitCode 0 的 CommanderError（属于正常退出）。
    let helpExitCode: number | undefined;
    const originalWrite = process.stdout.write.bind(process.stdout);
    // commander 直接写 process.stdout，这里临时静音帮助文本。
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      parseCliArgs(["--help"]);
    } catch (cause) {
      helpExitCode = (cause as { exitCode?: number }).exitCode;
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(helpExitCode).toBe(0);
  });

  it("normalizeBaseUrl 拒绝非 HTTP 地址并去掉尾部斜杠", () => {
    expect(normalizeBaseUrl("http://127.0.0.1:8123/")).toBe("http://127.0.0.1:8123");
    expect(normalizeBaseUrl("https://ztask.local")).toBe("https://ztask.local");
    expect(normalizeBaseUrl("ftp://127.0.0.1")).toBeNull();
    expect(normalizeBaseUrl("not-a-url")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
  });
});

describe("backup（管理端 HTTP）", () => {
  it("对真实 serve 端口执行：退出码 0 并生成备份目录；不可达/非法地址按失败语义退出", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);
    const handle: ServeHandle = await serve(validateServeConfig({ port: 0, dataDir }), { version: APP_VERSION });
    try {
      const url = `http://127.0.0.1:${handle.port}`;
      expect(await runBackup({ url: `${url}/` })).toBe(EXIT_OK);
      const backups = await readdir(path.join(dataDir, "backups"));
      expect(backups).toHaveLength(1);

      // 连接失败：明确提示并以操作失败退出。
      const unreachable = await runBackup({
        url,
        fetchImpl: (async () => {
          throw new Error("connect ECONNREFUSED");
        }) as typeof fetch,
      });
      expect(unreachable).toBe(EXIT_FAILURE);

      // 非法地址属于用法错误。
      expect(await runBackup({ url: "ftp://127.0.0.1:8123" })).toBe(EXIT_USAGE);
    } finally {
      await handle.close();
    }
  });

  it("管理端返回 409 BACKUP_IN_PROGRESS / 403 ADMIN_LOCAL_ONLY 时按失败退出", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);
    const makeFetch = (status: number, code: string): typeof fetch =>
      (async () =>
        new Response(JSON.stringify({ error: { code, message: "x", requestId: "r" } }), {
          status,
          headers: { "content-type": "application/json" },
        })) as typeof fetch;

    expect(await runBackup({ url: "http://127.0.0.1:8123", fetchImpl: makeFetch(409, "BACKUP_IN_PROGRESS") })).toBe(
      EXIT_FAILURE,
    );
    expect(await runBackup({ url: "http://127.0.0.1:8123", fetchImpl: makeFetch(403, "ADMIN_LOCAL_ONLY") })).toBe(
      EXIT_FAILURE,
    );
  });
});

describe("doctor / restore（离线）", () => {
  it("doctor 健康 0、发现问题 1、目录不存在 1；restore 成功 0、目标非空 1", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    expect(await runDoctor({ dataDir })).toBe(EXIT_OK);

    // 先做一份干净备份，再破坏当前目录以验证 doctor 的失败退出码。
    const backup = await createBackupService({
      dataDir,
      appVersion: APP_VERSION,
      timeZone: TIME_ZONE,
      clock: steppingClock("2026-11-02T09:00:00.000Z"),
      pauseWrites: () => store.pauseWrites(),
    }).create();

    await appendFile(taskRevisionsPath(dataDir, TASK_ID), '{"taskVersion":2', "utf8");
    expect(await runDoctor({ dataDir })).toBe(EXIT_FAILURE);
    expect(await runDoctor({ dataDir: path.join(dataDir, "missing") })).toBe(EXIT_FAILURE);

    const targetDir = path.join(dataDir, "restored-cli");
    expect(await runRestore({ backupDir: backup.backupDir, dataDir: targetDir, applicationVersion: APP_VERSION })).toBe(
      EXIT_OK,
    );
    // 目标已非空：重复恢复被拒绝。
    expect(await runRestore({ backupDir: backup.backupDir, dataDir: targetDir, applicationVersion: APP_VERSION })).toBe(
      EXIT_FAILURE,
    );
    // 损坏备份：拒绝并在退出码上体现。
    const brokenDir = path.join(dataDir, "broken-backup");
    await rm(brokenDir, { recursive: true, force: true });
    expect(await runRestore({ backupDir: path.join(dataDir, "no-such-backup"), dataDir: brokenDir, applicationVersion: APP_VERSION })).toBe(
      EXIT_FAILURE,
    );
  });
});
