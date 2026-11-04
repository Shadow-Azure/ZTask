import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { acquireDataDirLock } from "@ztask/server";
import { makeTempDataDir } from "../bootstrap/helpers.js";

describe("ztask serve 锁冲突输出", () => {
  it("第二个实例说明持有者与下一步，并以 1 退出", async () => {
    const dataDir = await makeTempDataDir();
    const lock = await acquireDataDirLock(dataDir);
    try {
      const result = spawnSync(
        process.execPath,
        ["apps/cli/dist/cli.js", "serve", "--no-open", "--port", "0", "--data-dir", dataDir],
        { cwd: process.cwd(), encoding: "utf8", timeout: 20_000 },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`启动失败：数据目录正被进程 ${process.pid} 持有`);
      expect(result.stderr).toContain(`数据目录：${dataDir}`);
      expect(result.stderr).toContain(path.join(dataDir, ".ztask-lock"));
      expect(result.stderr).toContain("同一个数据目录同时只能有一个 ztask serve 在运行");
      if (process.platform === "win32") {
        expect(result.stderr).toContain(`Get-Process -Id ${process.pid}`);
        expect(result.stderr).toContain(`Stop-Process -Id ${process.pid}`);
      } else {
        expect(result.stderr).toContain(`ps -p ${process.pid} -o pid,command`);
        expect(result.stderr).toContain(`kill ${process.pid}`);
      }
    } finally {
      await lock.release();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
