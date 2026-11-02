import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDataDirLayout } from "@ztask/server";

let dir: string;

beforeEach(async () => {
  dir = path.join("/tmp", `ztask-layout-spec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ensureDataDirLayout", () => {
  it("创建全部约定子目录且幂等", async () => {
    await ensureDataDirLayout(dir);
    await ensureDataDirLayout(dir);
    const entries = await readdir(dir);
    for (const expected of ["members", "folders", "tasks", "share-links", "auth-sessions", "locks", "backups", "tmp"]) {
      expect(entries, expected).toContain(expected);
    }
  });

  it("启动清理 tmp 目录内容，但不碰其他目录", async () => {
    await ensureDataDirLayout(dir);
    await writeFile(path.join(dir, "tmp", "leftover.bin"), "x", "utf8");
    await writeFile(path.join(dir, "members", "keep.json"), "{}", "utf8");
    await ensureDataDirLayout(dir);
    expect((await readdir(path.join(dir, "tmp"))).length).toBe(0);
    expect((await readdir(path.join(dir, "members")))).toEqual(["keep.json"]);
  });

  it("目录权限为 0700", async () => {
    await ensureDataDirLayout(dir);
    const { stat } = await import("node:fs/promises");
    expect((await stat(path.join(dir, "tasks"))).mode & 0o777).toBe(0o700);
  });
});
