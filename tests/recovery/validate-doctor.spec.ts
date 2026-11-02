// @vitest-environment node
import { appendFile, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  doctor,
  readTaskAggregate,
  taskCurrentPath,
  taskRevisionsPath,
  validateDataDir,
  writeJsonAtomic,
} from "@ztask/server";
import {
  FOLDER_ROOT_ID,
  TASK_ID,
  adminActor,
  makeTempDir,
  seedDataDir,
  snapshotTree,
} from "./support/fixtures.js";

/**
 * 只读校验与 doctor（#23 / 06 §8.3 / 07 §9）：
 * 干净数据通过；JSONL 尾部半行可自动修复；中间 checksum、current 不一致、引用缺失
 * 与形状问题需备份介入；doctor 绝不修改文件。
 */

const createdDirs: string[] = [];
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function newDataDir(): Promise<string> {
  const dir = await makeTempDir("ztask-doctor");
  createdDirs.push(dir);
  return dir;
}

/** 读取 current、改写后原子写回（模拟损坏/引用缺失）。 */
async function mutateCurrent(
  dataDir: string,
  mutate: (current: Record<string, unknown>) => void,
): Promise<void> {
  const current = (await readTaskAggregate(dataDir, TASK_ID)) as unknown as Record<string, unknown>;
  mutate(current);
  await writeJsonAtomic(taskCurrentPath(dataDir, TASK_ID), current);
}

describe("validateDataDir：干净数据目录", () => {
  it("无问题、manifest 可读、统计覆盖全部数据文件", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);

    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(true);
    expect(validation.issues).toEqual([]);
    expect(validation.manifest).toMatchObject({ formatVersion: 1, timeZone: "Asia/Shanghai" });
    expect(validation.stats.fileCount).toBe(validation.files.length);
    expect(validation.stats.fileCount).toBeGreaterThan(0);
    expect(validation.stats.byteCount).toBeGreaterThan(0);
    expect(validation.files.map((file) => file.path)).toEqual(expect.arrayContaining([
      "manifest.json",
      `folders/${FOLDER_ROOT_ID}.json`,
      `tasks/${TASK_ID}/current.json`,
      `tasks/${TASK_ID}/revisions.jsonl`,
    ]));

    const report = await doctor({ dataDir });
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.autoFixable).toEqual([]);
    expect(report.needsBackup).toEqual([]);
    expect(report.manifest?.applicationVersion).toBe("0.1.0");
    expect(report.suggestions).toHaveLength(1);
  });
});

describe("JSONL 尾部半行：可自动修复", () => {
  it("校验报告 jsonl-tail + fixable，且不截断文件；doctor 归入 autoFixable", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);
    const revisionsFile = taskRevisionsPath(dataDir, TASK_ID);
    const before = (await stat(revisionsFile)).size;
    const half = '{"formatVersion":1,"revisionId":"half';
    await appendFile(revisionsFile, half, "utf8");
    const afterAppend = (await stat(revisionsFile)).size;
    expect(afterAppend).toBe(before + Buffer.byteLength(half, "utf8"));

    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(false);
    expect(validation.issues).toHaveLength(1);
    expect(validation.issues[0]).toMatchObject({
      path: `tasks/${TASK_ID}/revisions.jsonl`,
      kind: "jsonl-tail",
      fixable: true,
    });
    // 只读：校验绝不截断半行（截断由启动恢复负责）。
    expect((await stat(revisionsFile)).size).toBe(afterAppend);

    const report = await doctor({ dataDir });
    expect(report.ok).toBe(false);
    expect(report.autoFixable).toHaveLength(1);
    expect(report.needsBackup).toEqual([]);
    expect(report.suggestions.join("\n")).toContain("重启 ztask serve");
  });
});

describe("不可自动修复的问题", () => {
  it("JSONL 中间 checksum 损坏：jsonl-checksum 且 fixable=false", async () => {
    const dataDir = await newDataDir();
    const store = await seedDataDir(dataDir);
    // 造出两行历史，再破坏第一行（真正的"中间损坏"）。
    await store.tasks.commit(TASK_ID, {
      expectedVersion: 1,
      changeKind: "progress",
      actor: adminActor(),
      mutate: (draft) => {
        draft.task.progress = 45;
      },
    });

    const revisionsFile = taskRevisionsPath(dataDir, TASK_ID);
    const raw = await readFile(revisionsFile, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    lines[0] = lines[0]!.replace(/"checksum":"[0-9a-f]{64}"/, `"checksum":"${"0".repeat(64)}"`);
    await writeFile(revisionsFile, `${lines.join("\n")}\n`, "utf8");

    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(false);
    expect(validation.issues[0]).toMatchObject({ kind: "jsonl-checksum", fixable: false });
    expect(validation.issues.some((issue) => issue.kind === "jsonl-tail")).toBe(false);

    const report = await doctor({ dataDir });
    expect(report.autoFixable).toEqual([]);
    expect(report.needsBackup.length).toBeGreaterThan(0);
    expect(report.suggestions.join("\n")).toContain("ztask restore");
  });

  it("current.revisionTip.checksum 与最新 revision 不一致：不可修复", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);

    await mutateCurrent(dataDir, (current) => {
      (current.revisionTip as Record<string, unknown>).checksum = "deadbeef";
    });
    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(false);
    expect(validation.issues[0]).toMatchObject({ kind: "revision-tip", fixable: false });
    expect(validation.issues[0]!.detail).toContain("revisionTip.checksum");

    const report = await doctor({ dataDir });
    expect(report.needsBackup.some((issue) => issue.kind === "revision-tip")).toBe(true);
  });

  it("current 领先 revision：拒绝自动修复", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);

    await mutateCurrent(dataDir, (current) => {
      current.taskVersion = 5;
      (current.revisionTip as Record<string, unknown>).taskVersion = 5;
    });
    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(false);
    expect(
      validation.issues.some((issue) => issue.kind === "revision-tip" && issue.detail.includes("领先")),
    ).toBe(true);
  });

  it("引用缺失：任务夹与成员引用都不成立", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);

    await mutateCurrent(dataDir, (current) => {
      (current.task as Record<string, unknown>).folderId = UNKNOWN_ID;
      const assignments = current.assignments as Array<Record<string, unknown>>;
      assignments[0]!.memberId = UNKNOWN_ID;
    });

    const validation = await validateDataDir(dataDir);
    expect(validation.ok).toBe(false);
    const referenceIssues = validation.issues.filter((issue) => issue.kind === "reference");
    expect(referenceIssues.length).toBeGreaterThanOrEqual(2);
    expect(referenceIssues.every((issue) => issue.fixable === false)).toBe(true);
    expect(referenceIssues.map((issue) => issue.detail).join("\n")).toContain("任务夹");

    const report = await doctor({ dataDir });
    expect(report.needsBackup.length).toBeGreaterThanOrEqual(2);
  });

  it("network.json 形状非法与 manifest 缺失：都需备份介入", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);
    await writeJsonAtomic(path.join(dataDir, "network.json"), {
      formatVersion: 1,
      shareListener: { enabled: "yes", host: null, port: null, shareBaseUrl: null },
    });

    let validation = await validateDataDir(dataDir);
    expect(validation.issues.some((issue) => issue.kind === "network" && issue.path === "network.json")).toBe(true);

    await rm(path.join(dataDir, "manifest.json"));
    validation = await validateDataDir(dataDir);
    expect(validation.issues.some((issue) => issue.kind === "manifest" && issue.fixable === false)).toBe(true);
    expect(validation.manifest).toBeNull();

    const report = await doctor({ dataDir });
    expect(report.manifest).toBeNull();
    expect(report.needsBackup.length).toBeGreaterThanOrEqual(2);
  });
});

describe("doctor 只读", () => {
  it("脏数据目录诊断前后所有文件的 mtime 与内容完全不变", async () => {
    const dataDir = await newDataDir();
    await seedDataDir(dataDir);
    // 同时造出可修复与不可修复问题，确保 doctor 遍历到所有分支。
    await appendFile(taskRevisionsPath(dataDir, TASK_ID), '{"taskVersion":2', "utf8");
    await mutateCurrent(dataDir, (current) => {
      (current.task as Record<string, unknown>).folderId = UNKNOWN_ID;
    });

    const before = await snapshotTree(dataDir);
    const report = await doctor({ dataDir });
    expect(report.ok).toBe(false);
    expect(report.autoFixable.length).toBeGreaterThan(0);
    expect(report.needsBackup.length).toBeGreaterThan(0);
    const after = await snapshotTree(dataDir);

    expect(after).toEqual(before);
  });
});
