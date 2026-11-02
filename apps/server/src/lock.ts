import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 数据目录已被存活进程持有时抛出；调用方应立即退出，不得继续写数据。 */
export class LockHeldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockHeldError";
  }
}

/** 已获取的数据目录锁；release 幂等。 */
export interface DataDirLock {
  release(): Promise<void>;
}

const LOCK_DIR_NAME = ".ztask-lock";

/**
 * 获取数据目录单写者锁（01 §6 / 04 §1：防多实例写同一目录）。
 * 锁即数据目录下的 `.ztask-lock` 目录；持死进程 pid 或缺 pid 文件的残锁视为陈旧可接管。
 * @param dataDir 数据目录（不存在则创建）。
 * @returns 锁句柄。
 * @throws LockHeldError 目录正被存活进程持有时。
 */
export async function acquireDataDirLock(dataDir: string): Promise<DataDirLock> {
  await mkdir(dataDir, { recursive: true });
  const lockDir = path.join(dataDir, LOCK_DIR_NAME);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockDir);
      break;
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw cause;
      if (attempt === 1) throw new LockHeldError(await heldMessage(lockDir));
      if (!(await isStaleLock(lockDir))) throw new LockHeldError(await heldMessage(lockDir));
      await rm(lockDir, { recursive: true, force: true });
    }
  }

  await writeFile(path.join(lockDir, "pid"), String(process.pid), "utf8");
  return {
    async release(): Promise<void> {
      await rm(lockDir, { recursive: true, force: true });
    },
  };
}

/** 拒绝消息里带持有者 pid，便于现场诊断。 */
async function heldMessage(lockDir: string): Promise<string> {
  const pid = await readPid(lockDir);
  return pid ? `数据目录正被进程 ${pid} 持有` : `数据目录锁不可用：${lockDir}`;
}

/** 残锁判定：pid 文件缺失，或 pid 不再存活。 */
async function isStaleLock(lockDir: string): Promise<boolean> {
  const pid = await readPid(lockDir);
  if (pid === null) return true;
  return !isPidAlive(pid);
}

async function readPid(lockDir: string): Promise<number | null> {
  try {
    const raw = await readFile(path.join(lockDir, "pid"), "utf8");
    const pid = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
}
