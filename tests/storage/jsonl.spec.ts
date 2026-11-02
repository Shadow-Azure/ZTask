import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StorageCorruptionError, appendJsonlLine, iterateJsonl, recoverJsonlTail } from "@ztask/server";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = path.join("/tmp", `ztask-jsonl-spec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  file = path.join(dir, "revisions.jsonl");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function makeRecord(taskVersion: number): Record<string, unknown> {
  return { taskId: "t-1", taskVersion, changeKind: "update", snapshot: { progress: taskVersion * 10 } };
}

describe("appendJsonlLine + iterateJsonl", () => {
  it("追加行以换行结尾，读回顺序一致且 checksum 可验证", async () => {
    await appendJsonlLine(file, makeRecord(1));
    await appendJsonlLine(file, makeRecord(2));
    const seen: Array<Record<string, unknown>> = [];
    await iterateJsonl(file, (record) => {
      seen.push(record);
    });
    expect(seen.map((r) => r.taskVersion)).toEqual([1, 2]);
    for (const record of seen) {
      expect(typeof record.checksum).toBe("string");
    }
  });

  it("篡改中间字段后 checksum 校验显式报错", async () => {
    await appendJsonlLine(file, makeRecord(1));
    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = await readFile(file, "utf8");
    const tampered = raw.replace('"taskVersion":1', '"taskVersion":99');
    await writeFile(file, tampered, "utf8");
    await expect(iterateJsonl(file, () => undefined)).rejects.toBeInstanceOf(StorageCorruptionError);
  });
});

describe("recoverJsonlTail", () => {
  it("合法半行尾部：备份原文件后截断到最后完整行", async () => {
    await appendJsonlLine(file, makeRecord(1));
    const { readFile, appendFile } = await import("node:fs/promises");
    await appendFile(file, '{"taskId":"t-1","taskVersion":2,"changeKi', "utf8");
    const result = await recoverJsonlTail(file);
    expect(result.recovered).toBe(true);

    const seen: Array<Record<string, unknown>> = [];
    await iterateJsonl(file, (record) => {
      seen.push(record);
    });
    expect(seen.map((r) => r.taskVersion)).toEqual([1]);

    const backups = (await readdir(dir)).filter((name) => name.includes("corrupt"));
    expect(backups.length).toBe(1);
    const backupRaw = await readFile(path.join(dir, backups[0]!), "utf8");
    expect(backupRaw).toContain('"changeKi');
    void readFile;
  });

  it("完全干净文件：不动作、不产生备份", async () => {
    await appendJsonlLine(file, makeRecord(1));
    const result = await recoverJsonlTail(file);
    expect(result.recovered).toBe(false);
    expect((await readdir(dir)).filter((name) => name.includes("corrupt"))).toEqual([]);
  });

  it("中间行 checksum 损坏：拒绝自动修复并显式报错", async () => {
    await appendJsonlLine(file, makeRecord(1));
    const { readFile, writeFile, appendFile } = await import("node:fs/promises");
    const good = await readFile(file, "utf8");
    const tamperedFirst = good.replace('"taskVersion":1', '"taskVersion":77');
    await writeFile(file, tamperedFirst, "utf8");
    await appendJsonlLine(file, makeRecord(2));
    await expect(recoverJsonlTail(file)).rejects.toBeInstanceOf(StorageCorruptionError);
    void appendFile;
  });
});
