// @vitest-environment node
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tmpDataDir } from "./support/fakes.js";
import { buildApp, initStore, validateServeConfig } from "@ztask/server";

/**
 * 安全响应头（04 §8）：全局 CSP 是 #20 的欠账（#41 检视记录「CSP 记 #20」）。
 *
 * 断言口径：
 * - 所有响应都带同一条 CSP；
 * - 脚本只允许同源（LAN 分享域与 loopback 同壳，不能引入第三方脚本）；
 * - 行内样式按 Vue `:style` 需要显式放开，但不能顺手放开 `script-src`；
 * - CSP 与 Referrer-Policy / nosniff 同源同层，覆盖健康、API 404 与静态壳。
 */

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createApp(staticRoot: string | null) {
  const dataDir = await tmpDataDir();
  created.push(dataDir);
  await mkdir(dataDir, { recursive: true });
  const store = await initStore({ dataDir, applicationVersion: "0.0.0" });
  const app = await buildApp(validateServeConfig({ port: 0, dataDir, staticRoot }), { store });
  return app;
}

describe("全局 CSP（04 §8、08 §5）", () => {
  it("健康检查、未知 API 404 与 SPA 静态壳都带同一份 CSP", async () => {
    const staticRoot = await tmpDataDir();
    created.push(staticRoot);
    await mkdir(staticRoot, { recursive: true });
    await writeFile(join(staticRoot, "index.html"), "<!doctype html><title>ZTask</title>", "utf8");

    const app = await createApp(staticRoot);
    try {
      const responses = [
        await app.inject({ method: "GET", url: "/api/v1/health" }),
        await app.inject({ method: "GET", url: "/api/v1/unknown" }),
        await app.inject({ method: "GET", url: "/" }),
        await app.inject({ method: "GET", url: "/members" }),
      ];
      expect(responses.map((response) => response.statusCode)).toEqual([200, 404, 200, 200]);

      const policies = responses.map((response) => response.headers["content-security-policy"]);
      expect(new Set(policies).size).toBe(1);
      const policy = String(policies[0]);
      expect(policy).toContain("default-src 'self'");
      expect(policy).toContain("script-src 'self'");
      expect(policy).toContain("style-src 'self' 'unsafe-inline'");
      expect(policy).toContain("connect-src 'self'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
      expect(policy).not.toContain("'unsafe-eval'");

      for (const response of responses) {
        expect(response.headers["referrer-policy"]).toBe("no-referrer");
        expect(response.headers["x-content-type-options"]).toBe("nosniff");
      }
    } finally {
      await app.close();
    }
  });
});
