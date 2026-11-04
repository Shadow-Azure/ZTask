import { describe, expect, it } from "vitest";
import { formatLockHeldMessage } from "@ztask/cli";
import { LockHeldError } from "@ztask/server";

/** 构造一个带现场信息的锁冲突错误；pid 为 null 表示读不到持有者。 */
function lockHeld(pid: number | null): LockHeldError {
  const lockDir = "/tmp/ztask/.ztask-lock";
  return new LockHeldError(
    pid === null ? `数据目录锁不可用：${lockDir}` : `数据目录正被进程 ${pid} 持有`,
    { dataDir: "/tmp/ztask", lockDir, pid },
  );
}

describe("formatLockHeldMessage", () => {
  it("说明持有者、数据目录、管理端地址与 POSIX 停止命令", () => {
    const text = formatLockHeldMessage(lockHeld(1234), {
      host: "127.0.0.1",
      port: 8123,
      platform: "linux",
    });
    expect(text).toContain("启动失败：数据目录正被进程 1234 持有");
    expect(text).toContain("数据目录：/tmp/ztask");
    expect(text).toContain("管理端：http://127.0.0.1:8123/");
    expect(text).toContain("同一个数据目录同时只能有一个 ztask serve 在运行");
    expect(text).toContain("ps -p 1234 -o pid,command");
    expect(text).toContain("kill 1234");
    expect(text).toContain("PID 被其他程序复用");
    expect(text).toContain("/tmp/ztask/.ztask-lock");
    expect(text).not.toContain("Get-Process");
  });

  it("Windows 使用 PowerShell 查看与停止命令", () => {
    const text = formatLockHeldMessage(lockHeld(1234), {
      host: "127.0.0.1",
      port: 8123,
      platform: "win32",
    });
    expect(text).toContain("Get-Process -Id 1234");
    expect(text).toContain("Stop-Process -Id 1234");
    expect(text).not.toContain("ps -p 1234");
    expect(text).not.toContain("kill 1234");
  });

  it("端口为 0 时不伪造管理端地址", () => {
    const text = formatLockHeldMessage(lockHeld(1234), { host: "127.0.0.1", port: 0, platform: "linux" });
    expect(text).toContain("本次启动使用内核分配的端口");
    expect(text).not.toContain("http://127.0.0.1:0");
    expect(text).toContain("打开它启动时打印的管理端地址");
  });

  it("IPv6 监听地址加方括号", () => {
    const text = formatLockHeldMessage(lockHeld(1234), { host: "::1", port: 8123, platform: "linux" });
    expect(text).toContain("管理端：http://[::1]:8123/");
  });

  it("读不到 PID 时说明可能原因与清理前提", () => {
    const text = formatLockHeldMessage(lockHeld(null), { host: "127.0.0.1", port: 8123, platform: "linux" });
    expect(text).toContain("启动失败：数据目录锁不可用：/tmp/ztask/.ztask-lock");
    expect(text).toContain("读不到持有者 PID");
    expect(text).toContain("确认没有 ZTask 正在写该目录");
    expect(text).toContain("/tmp/ztask/.ztask-lock");
    expect(text).not.toContain("kill");
  });
});
