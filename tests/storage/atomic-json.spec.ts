import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EntryNotFoundError, readJsonFile, writeJsonAtomic } from "@ztask/server";

let dir: string;

beforeEach(async () => {
  dir = path.join("/tmp", `ztask-storage-spec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("writeJsonAtomic", () => {
  it("写入后可读回，文件以换行结尾", async () => {
    const file = path.join(dir, "current.json");
    await writeJsonAtomic(file, { a: 1, b: "文本\n换行" });
    expect(await readJsonFile(file)).toEqual({ a: 1, b: "文本\n换行" });
    expect((await readFile(file, "utf8")).endsWith("\n")).toBe(true);
  });

  it("覆盖旧内容且不残留临时文件", async () => {
    const file = path.join(dir, "current.json");
    await writeJsonAtomic(file, { version: 1 });
    await writeJsonAtomic(file, { version: 2 });
    expect(await readJsonFile(file)).toEqual({ version: 2 });
    const leftovers = (await readdir(dir)).filter((name) => name.startsWith(".ztask-tmp-"));
    expect(leftovers).toEqual([]);
  });

  it("beforeRename 注入失败时旧文件保持完整", async () => {
    const file = path.join(dir, "current.json");
    await writeJsonAtomic(file, { state: "old" });
    await expect(
      writeJsonAtomic(file, { state: "new" }, { beforeRename: () => { throw new Error("injected"); } }),
    ).rejects.toThrow("injected");
    expect(await readJsonFile(file)).toEqual({ state: "old" });
  });

  it("文件权限为 0600", async () => {
    const file = path.join(dir, "private.json");
    await writeJsonAtomic(file, { ok: true });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });
});

describe("readJsonFile", () => {
  it("缺失文件抛 EntryNotFoundError", async () => {
    await expect(readJsonFile(path.join(dir, "missing.json"))).rejects.toBeInstanceOf(EntryNotFoundError);
  });

  it("损坏 JSON 显式报错，不返回半文件内容", async () => {
    const file = path.join(dir, "broken.json");
    await writeFile(file, '{"taskVersion": 4, "trunc', "utf8");
    await expect(readJsonFile(file)).rejects.toThrow();
  });
});
