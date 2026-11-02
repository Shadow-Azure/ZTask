import { open, readFile, rename, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { EntryNotFoundError, StorageCorruptionError } from "./errors.js";
import { TEMP_PREFIX } from "./paths.js";

/** writeJsonAtomic 的故障注入缝：测试在指定步骤抛错模拟崩溃。 */
export interface AtomicWriteHooks {
  /** rename（原子发布点）之前抛错 = 崩溃在发布前，旧文件应保持完整。 */
  beforeRename?: () => void;
}

/**
 * 原子写 JSON：同目录临时文件（0600）→ 完整写入 + fsync → rename 原子替换 → 尽力 fsync 父目录（06 §8.1）。
 * 任何一步失败都不会破坏目标文件已存在的旧内容。
 * @param filePath 目标文件绝对/相对路径。
 * @param value 可 JSON 序列化的值；落盘为规范化排序后的 JSON + 换行。
 * @param hooks 测试故障注入缝。
 */
export async function writeJsonAtomic(filePath: string, value: unknown, hooks?: AtomicWriteHooks): Promise<void> {
  const dir = dirname(filePath);
  const temp = join(dir, `${TEMP_PREFIX}${randomUUID()}`);
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(temp, "w", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    hooks?.beforeRename?.();
    await rename(temp, filePath);
  } catch (cause) {
    await rmTempQuietly(temp);
    throw cause;
  }
  await fsyncDirQuietly(dir);
}

/**
 * 读取并解析 JSON 文件；文件缺失抛 EntryNotFoundError，内容损坏抛 StorageCorruptionError。
 * @param filePath 目标文件路径。
 * @returns 解析后的值。
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      throw new EntryNotFoundError(`文件不存在：${filePath}`);
    }
    throw cause;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new StorageCorruptionError(`JSON 解析失败（文件可能不完整）：${filePath}`);
  }
}

async function rmTempQuietly(temp: string): Promise<void> {
  try {
    await (await import("node:fs/promises")).rm(temp, { force: true });
  } catch {
    // 清理失败不影响主错误传播
  }
}

async function fsyncDirQuietly(dir: string): Promise<void> {
  try {
    await stat(dir);
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // 平台不支持目录 fsync 时忽略（06 §8.1：支持的平台上 fsync 父目录）
  }
}
