import { LockHeldError } from "@ztask/server";

/** 渲染数据目录锁冲突所需的本进程启动上下文。 */
export interface LockHeldMessageContext {
  /** 本次启动的管理端监听地址。 */
  host: string;
  /** 本次启动的管理端端口；0 表示由内核分配。 */
  port: number;
  /** 平台判断来源；默认当前进程，测试可注入。 */
  platform?: NodeJS.Platform;
}

/**
 * 把数据目录锁冲突渲染成可直接写入 stderr 的多行启动错误。
 *
 * 第一行保留 `启动失败：<message>`，随后给出数据目录与已知管理端地址；
 * 持有者存活时再给出当前平台的查看/停止命令与 PID 复用处理，
 * 读不到 PID 时说明可能原因与清理锁目录的前提。
 * @param error 锁冲突错误，携带数据目录、锁目录与持有者 PID。
 * @param context 本次启动的管理端地址与平台。
 * @returns 多行错误文本（不含末尾换行）。
 */
export function formatLockHeldMessage(error: LockHeldError, context: LockHeldMessageContext): string {
  const platform = context.platform ?? process.platform;
  const url = adminUrl(context.host, context.port);
  const lines = [`启动失败：${error.message}`, "", `  数据目录：${error.dataDir}`];
  lines.push(
    url === null
      ? "  管理端：本次启动使用内核分配的端口；已在运行实例的地址以它启动时打印的为准。"
      : `  管理端：${url}`,
  );
  lines.push("");

  if (error.pid === null) {
    lines.push("锁目录存在，但读不到持有者 PID。这可能是锁目录权限异常，或另一个启动流程刚创建了锁。");
    lines.push("确认没有 ZTask 正在写该目录后，删除下面的锁目录再重新启动：");
    lines.push(`      ${error.lockDir}`);
    return lines.join("\n");
  }

  lines.push("同一个数据目录同时只能有一个 ztask serve 在运行。可以：");
  lines.push(
    url === null
      ? "  - 直接使用已在运行的实例：打开它启动时打印的管理端地址。"
      : "  - 直接使用已在运行的实例：打开上面的地址；若之前用不同端口启动，以它启动时打印的地址为准。",
  );
  lines.push("  - 重启：在它所在的终端按 Ctrl+C 停止；找不到终端时执行：");
  if (platform === "win32") {
    lines.push(`      Get-Process -Id ${error.pid}`);
    lines.push(`      Stop-Process -Id ${error.pid}`);
  } else {
    lines.push(`      ps -p ${error.pid} -o pid,command`);
    lines.push(`      kill ${error.pid}`);
  }
  lines.push(`  - 如果进程 ${error.pid} 不是 ZTask（PID 被其他程序复用）：确认没有 ZTask 正在写该目录后，删除`);
  lines.push(`      ${error.lockDir}`);
  lines.push("    再重新启动。");
  return lines.join("\n");
}

/** 把监听地址与端口拼成管理端 URL；端口尚未确定时返回 null。 */
function adminUrl(host: string, port: number): string | null {
  if (port === 0) return null;
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${bracketed}:${port}/`;
}
