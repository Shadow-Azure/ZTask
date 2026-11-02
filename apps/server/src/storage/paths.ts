import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

/** 06 §2 数据目录约定布局；locks 由单写者锁占用 `.ztask-lock`，不额外建目录。 */
export const DATA_SUBDIRS = [
  "members",
  "folders",
  "tasks",
  "share-links",
  "auth-sessions",
  "locks",
  "backups",
  "tmp",
] as const;

/** 本存储层写临时文件的前缀；启动清理只针对该前缀，绝不碰用户其他文件（07 §2.1）。 */
export const TEMP_PREFIX = ".ztask-tmp-";

/**
 * 建立数据目录布局（0700）并清理 tmp/ 残留；幂等，启动时调用。
 * 同目录原子写临时文件（`.ztask-tmp-*`）散布在各子目录内，一并按前缀清理——
 * 单写者锁保证此刻没有其他进程在写。
 * @param dataDir 数据目录根。
 */
export async function ensureDataDirLayout(dataDir: string): Promise<void> {
  for (const sub of DATA_SUBDIRS) {
    await mkdir(path.join(dataDir, sub), { recursive: true, mode: 0o700 });
  }
  const tmpDir = path.join(dataDir, "tmp");
  for (const entry of await readdir(tmpDir)) {
    await rm(path.join(tmpDir, entry), { recursive: true, force: true });
  }
  await sweepTempFiles(dataDir, DATA_SUBDIRS.filter((sub) => sub !== "tmp"));
}

async function sweepTempFiles(dataDir: string, subdirs: readonly string[]): Promise<void> {
  for (const sub of subdirs) {
    const subDir = path.join(dataDir, sub);
    let entries: string[];
    try {
      entries = await readdir(subDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.startsWith(TEMP_PREFIX)) continue;
      const full = path.join(subDir, entry);
      await rm(full, { recursive: true, force: true });
    }
  }
}
