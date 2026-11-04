import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** 数据目录已被存活进程持有时抛出；调用方应立即退出，不得继续写数据。 */
export class LockHeldError extends Error {
  /** 被占用的数据目录。 */
  readonly dataDir: string;
  /** 数据目录锁目录（`.ztask-lock`）。 */
  readonly lockDir: string;
  /** 锁记录的持有者 pid；读不到时为 null。 */
  readonly pid: number | null;

  /**
   * @param message 单行拒绝原因。
   * @param details 现场信息：数据目录、锁目录与持有者 pid。
   */
  constructor(message: string, details: { dataDir: string; lockDir: string; pid: number | null }) {
    super(message);
    this.name = "LockHeldError";
    this.dataDir = details.dataDir;
    this.lockDir = details.lockDir;
    this.pid = details.pid;
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
      if (attempt === 1) throw await lockHeldError(dataDir, lockDir);
      if (!(await isStaleLock(lockDir))) throw await lockHeldError(dataDir, lockDir);
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

/** 构造携带数据目录与持有者现场的单行锁冲突错误。 */
async function lockHeldError(dataDir: string, lockDir: string): Promise<LockHeldError> {
  const pid = await readPid(lockDir);
  return new LockHeldError(
    pid === null ? `数据目录锁不可用：${lockDir}` : `数据目录正被进程 ${pid} 持有`,
    { dataDir, lockDir, pid },
  );
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
