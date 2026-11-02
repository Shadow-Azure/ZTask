// @vitest-environment node
import { access, mkdir, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { serve, validateServeConfig } from "@ztask/server";
import { tmpDataDir } from "./support/fakes.js";

/**
 * bootstrap 装配（07 §1）：`--lan` 失败不阻止 loopback 启动，且 CLI 能拿到脱敏原因。
 * 本 spec 只监听 127.0.0.1:0，不触碰任何真实局域网地址。
 */

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("serve 与 --lan（01 §3 / 04 §9）", () => {
  it("--lan 为非本机/loopback 地址：loopback 正常启动，lanError 脱敏且分享未运行", async () => {
    const dataDir = await tmpDataDir();
    createdDirs.push(dataDir);
    await mkdir(dataDir, { recursive: true });

    const config = validateServeConfig({ port: 0, dataDir, lanHost: "127.0.0.1" });
    const handle = await serve(config, { version: "9.9.9" });
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(handle.lanError).toBeTruthy();
      expect(handle.lanError).not.toContain(dataDir);
      expect(handle.networkService.isRunning()).toBe(false);
      expect(handle.networkService.shareBaseUrl()).toBeNull();

      const health = await fetch(`http://127.0.0.1:${handle.port}/api/v1/health`);
      expect(health.status).toBe(200);
      expect(((await health.json()) as { version: string }).version).toBe("9.9.9");

      // 管理端路由挂上了网络与分享服务：network 可用，成员列表 shareLink 为 null。
      const network = await fetch(`http://127.0.0.1:${handle.port}/api/v1/admin/network`);
      expect(network.status).toBe(200);
      const state = (await network.json()) as { loopbackUrl: string; shareListener: { running: boolean } };
      expect(state.loopbackUrl).toBe(`http://127.0.0.1:${handle.port}`);
      expect(state.shareListener.running).toBe(false);

      const created = await fetch(`http://127.0.0.1:${handle.port}/api/v1/admin/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "陈晨" }),
      });
      expect(created.status).toBe(201);
      expect(((await created.json()) as { shareLink: unknown }).shareLink).toBeNull();
    } finally {
      await handle.close();
      // close 幂等：CLI 的 SIGINT/SIGTERM 可能重复触发。
      await handle.close();
    }
  });

  it("未指定 --lan：分享保持未开启，network.json 不生成", async () => {
    const dataDir = await tmpDataDir();
    createdDirs.push(dataDir);
    await mkdir(dataDir, { recursive: true });

    const handle = await serve(validateServeConfig({ port: 0, dataDir }));
    try {
      expect(handle.lanError).toBeNull();
      expect(handle.networkService.isRunning()).toBe(false);
      const state = handle.networkService.state();
      expect(state.shareListener).toMatchObject({ enabled: false, running: false, degraded: false });
      await expect(access(`${dataDir}/network.json`)).rejects.toThrow();
    } finally {
      await handle.close();
    }
  });
});
