// @vitest-environment node
import { readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { doctor, SCHEMA_VERSION, validateDataDir } from "@ztask/server";
import { makeTempDir, seedDataDir } from "./support/fixtures.js";

/**
 * 只读校验与 doctor（#23 / 06 §8.3 / 07 §9）：
 * 干净 SQLite 数据通过；损坏页/结构问题需备份介入；doctor 不修改数据库。
 */

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newDataDir(): Promise<string> {
  const dir = await makeTempDir("ztask-doctor");
  createdDirs.push(dir);
  return dir;
}

describe("validateDataDir：干净 SQLite 数据目录", () => {
  it("无问题、meta 可读、统计覆盖数据库文件", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await store.close();

    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.manifest).toMatchObject({ formatVersion: SCHEMA_VERSION, timeZone: "Asia/Shanghai" });
    expect(validation.stats.fileCount).toBe(validation.files.length);
    expect(validation.stats.fileCount).toBeGreaterThan(0);
    expect(validation.stats.byteCount).toBeGreaterThan(0);
    expect(validation.files.map((file) => file.path)).toContain("ztask.db");

    const report = await doctor({ dataDir });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.autoFixable).toEqual([]);
    expect(report.needsBackup).toEqual([]);
    expect(report.manifest?.applicationVersion).toBe("0.1.0");
    expect(report.suggestions).toHaveLength(1);
  });
});

describe("不可自动修复的问题", () => {
  it("ztask.db 不是可读数据库：sqlite 问题、需备份介入", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await store.close();
    await writeFile(path.join(dataDir, "ztask.db"), "not a sqlite database", "utf8");

    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(false);
    expect(validation.issues.length).toBeGreaterThan(0);
    expect(validation.issues.every((issue) => issue.kind === "sqlite" && issue.fixable === false)).toBe(true);

    const report = await doctor({ dataDir });
    expect(report.ok).toBe(false);
    expect(report.autoFixable).toEqual([]);
    expect(report.needsBackup.length).toBeGreaterThan(0);
    expect(report.suggestions.join("\n")).toContain("ztask restore");
  });

  it("ztask.db 缺失且没有旧 manifest：manifest 问题、需备份介入", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await store.close();
    await rm(path.join(dataDir, "ztask.db"));

    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(false);
    expect(validation.manifest).toBeNull();
    expect(validation.issues.some((issue) => issue.kind === "manifest" && issue.fixable === false)).toBe(true);

    const report = await doctor({ dataDir });
    expect(report.manifest).toBeNull();
    expect(report.needsBackup.length).toBeGreaterThan(0);
  });
});

describe("doctor 只读", () => {
  it("诊断前后 ztask.db 字节内容不变", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    await store.close();
    const dbPath = path.join(dataDir, "ztask.db");
    const before = await readFile(dbPath);
    const beforeMtime = (await stat(dbPath)).mtimeMs;

    const report = await doctor({ dataDir });
    expect(report.ok).toBe(true);

    expect(await readFile(dbPath)).toEqual(before);
    expect((await stat(dbPath)).mtimeMs).toBe(beforeMtime);
  });
});
