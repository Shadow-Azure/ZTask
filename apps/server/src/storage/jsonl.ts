import { copyFile, open, readFile, truncate } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { checksumOf } from "./checksum.js";
import { StorageCorruptionError } from "./errors.js";

/**
 * 追加一条记录到 JSONL：整行一次写入 + 换行 + fsync（06 §7/§8.2，append+fsync 是逻辑提交点）。
 * 行内容为规范化 JSON，checksum 对剔除 checksum 字段后的记录计算后并入行内。
 *
 * fsync 必须使用带写权限的句柄：Windows 的 `FlushFileBuffers` 作用在只读句柄上
 * 会返回 `EPERM`，会让每次 revision 追加都失败并表现为保存 500。因此这里用追加
 * 模式（`a`）打开同一个文件完成写入与 sync，而不是写入后再用 `r` 重新打开。
 * @param filePath JSONL 文件路径（不存在则创建）。
 * @param record 不含 checksum 的记录对象。
 * @returns 本次写入记录的 checksum（供 current.revisionTip 与行内值保持一致）。
 */
export async function appendJsonlLine(filePath: string, record: Record<string, unknown>): Promise<string> {
  const checksum = checksumOf(record);
  const withChecksum = { ...record, checksum };
  const handle = await open(filePath, "a");
  try {
    await handle.appendFile(`${JSON.stringify(withChecksum)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return checksum;
}

/**
 * 流式逐行读取 JSONL 并校验 checksum；任何一行损坏都显式报错，不静默跳过（06 §8.3）。
 * @param filePath JSONL 文件路径。
 * @param visitor 每条完整记录的回调（不含文件尾空行）。
 */
export async function iterateJsonl(
  filePath: string,
  visitor: (record: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (line.length === 0) continue;
      visitor(parseAndVerifyLine(line, filePath, lineNumber));
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** 解析单行并校验 checksum；不匹配即损坏。 */
function parseAndVerifyLine(line: string, file: string, lineNumber: number): Record<string, unknown> {
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(line) as Record<string, unknown>;
  } catch {
    throw new StorageCorruptionError(`JSONL 第 ${lineNumber} 行不是完整 JSON：${file}`);
  }
  const { checksum, ...rest } = record;
  if (typeof checksum !== "string" || checksum !== checksumOf(rest)) {
    throw new StorageCorruptionError(`JSONL 第 ${lineNumber} 行 checksum 不匹配：${file}`);
  }
  return record;
}

/** recoverJsonlTail 的结果。 */
export interface TailRecoveryResult {
  /** 是否发生了截断修复。 */
  recovered: boolean;
  /** 截掉的尾部字节数（recovered=false 时为 0）。 */
  removedBytes: number;
}

/**
 * 启动时的 JSONL 尾部恢复（06 §8.3）：先全量校验——中间行损坏直接拒绝（提示恢复备份）；
 * 仅最后一个"不完整记录"（缺换行/JSON 不完整/最后一行 checksum 不匹配）可修复：
 * 备份原文件到同目录 `<name>.corrupt-<毫秒>` 后截断到最后完整行。
 * @param filePath JSONL 文件路径；文件不存在视为空日志（不报错）。
 * @returns 恢复结果（是否截断、截掉字节数）。
 */
export async function recoverJsonlTail(filePath: string): Promise<TailRecoveryResult> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { recovered: false, removedBytes: 0 };
    throw cause;
  }
  if (raw.length === 0) return { recovered: false, removedBytes: 0 };

  const endsWithNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (endsWithNewline) lines.pop();
  const completeLines = endsWithNewline ? lines : lines.slice(0, -1);

  // 中间行（以及有换行结尾时的所有行）必须全部有效；否则拒绝自动修复。
  for (let index = 0; index < completeLines.length; index += 1) {
    const line = completeLines[index] ?? "";
    if (line.length === 0) continue;
    parseAndVerifyLine(line, filePath, index + 1);
  }

  // 最后一行带换行且前文全部有效：整个文件完好。
  if (endsWithNewline) return { recovered: false, removedBytes: 0 };

  // 尾巴是否可解析不影响处置：06 §8.3 规定缺换行/不完整/最后一行 checksum 不匹配都属"未完成写入"，
  // 先备份原文件再截断到最后完整行；字节级歧义不允许带病上岗。
  const lastGoodBytes = Buffer.byteLength(completeLines.join("\n"), "utf8") + (completeLines.length > 0 ? 1 : 0);
  const removedBytes = Buffer.byteLength(raw, "utf8") - lastGoodBytes;
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  await copyFile(filePath, `${filePath}.corrupt-${stamp}`);
  await truncate(filePath, lastGoodBytes);
  return { recovered: true, removedBytes };
}
