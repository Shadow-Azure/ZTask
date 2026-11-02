import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UnsupportedFormatError, initManifest, readManifest } from "@ztask/server";

let dir: string;

beforeEach(async () => {
  dir = path.join("/tmp", `ztask-manifest-spec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("initManifest", () => {
  it("空目录初始化：formatVersion 1 + 应用版本 + RFC3339 创建时刻", async () => {
    const manifest = await initManifest(dir, { applicationVersion: "0.1.0" });
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.applicationVersion).toBe("0.1.0");
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("首次创建默认使用服务主机时区（#21 看板「今天」依赖它）", async () => {
    const manifest = await initManifest(dir, { applicationVersion: "0.1.0" });
    expect(manifest.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("重复初始化幂等：返回已存在内容", async () => {
    const first = await initManifest(dir, { applicationVersion: "0.1.0" });
    const second = await initManifest(dir, { applicationVersion: "0.2.0" });
    expect(second).toEqual(first);
  });

  it("manifest 格式版本比应用新时拒绝启动", async () => {
    const { writeJsonAtomic } = await import("@ztask/server");
    await writeJsonAtomic(path.join(dir, "manifest.json"), {
      formatVersion: 2,
      applicationVersion: "0.1.0",
      createdAt: "2026-11-01T02:00:00.000Z",
      timeZone: "UTC",
    });
    await expect(initManifest(dir, { applicationVersion: "0.1.0" })).rejects.toBeInstanceOf(UnsupportedFormatError);
  });

  it("manifest JSON 损坏时显式报错", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "manifest.json"), "{broken", "utf8");
    await expect(initManifest(dir, { applicationVersion: "0.1.0" })).rejects.toThrow();
  });

  it("readManifest 读取已存在 manifest", async () => {
    await initManifest(dir, { applicationVersion: "0.1.0" });
    const manifest = await readManifest(dir);
    expect(manifest.formatVersion).toBe(1);
  });
});
