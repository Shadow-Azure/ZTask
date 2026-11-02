import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireDataDirLock, LockHeldError, serve, validateServeConfig } from "@ztask/server";
import { makeTempDataDir } from "./helpers.js";

describe("数据目录单写者锁", () => {
  it("获得锁后，第二个实例被拒绝", async () => {
    const dataDir = await makeTempDataDir();
    const first = await acquireDataDirLock(dataDir);
    await expect(acquireDataDirLock(dataDir)).rejects.toBeInstanceOf(LockHeldError);
    await first.release();
  });

  it("释放后可重新获得", async () => {
    const dataDir = await makeTempDataDir();
    const first = await acquireDataDirLock(dataDir);
    await first.release();
    const second = await acquireDataDirLock(dataDir);
    await second.release();
  });

  it("无 pid 文件的残锁视为陈旧，可接管", async () => {
    const dataDir = await makeTempDataDir();
    await mkdir(path.join(dataDir, ".ztask-lock"), { recursive: true });
    const lock = await acquireDataDirLock(dataDir);
    await lock.release();
  });

  it("持有死 pid 的残锁视为陈旧，可接管", async () => {
    const dataDir = await makeTempDataDir();
    const lockDir = path.join(dataDir, ".ztask-lock");
    await mkdir(lockDir, { recursive: true });
    await writeFile(path.join(lockDir, "pid"), String(4_000_000), "utf8");
    const lock = await acquireDataDirLock(dataDir);
    await lock.release();
  });

  it("release 清理锁目录，可重复调用（幂等）", async () => {
    const dataDir = await makeTempDataDir();
    const lock = await acquireDataDirLock(dataDir);
    await lock.release();
    await lock.release();
    await expect(acquireDataDirLock(dataDir)).resolves.toBeTruthy();
    await rm(path.join(dataDir, ".ztask-lock"), { recursive: true, force: true });
  });
});

describe("serve 生命周期", () => {
  it("启动后可访问健康检查；close 释放锁与端口", async () => {
    const dataDir = await makeTempDataDir();
    const config = validateServeConfig({ port: 0, dataDir });
    const handle = await serve(config);
    try {
      expect(handle.port).toBeGreaterThan(0);
      const response = await fetch(`http://127.0.0.1:${handle.port}/api/v1/health`);
      expect(response.status).toBe(200);
    } finally {
      await handle.close();
    }

    await expect(acquireDataDirLock(dataDir)).resolves.toBeTruthy();
    await rm(path.join(dataDir, ".ztask-lock"), { recursive: true, force: true });
  });

  it("同 dataDir 的第二个 serve 被拒绝，首个实例不受影响", async () => {
    const dataDir = await makeTempDataDir();
    const config = validateServeConfig({ port: 0, dataDir });
    const first = await serve(config);
    try {
      await expect(serve(config)).rejects.toBeInstanceOf(LockHeldError);
      const response = await fetch(`http://127.0.0.1:${first.port}/api/v1/health`);
      expect(response.status).toBe(200);
    } finally {
      await first.close();
    }
  });
});
