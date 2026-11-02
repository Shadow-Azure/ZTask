import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import { StorageCorruptionError, UnsupportedFormatError } from "./errors.js";

/** 当前应用支持的存储格式版本（06 §3）：升级只能经可重入 migration。 */
export const SUPPORTED_FORMAT_VERSION = 1;

/** manifest.json 内容（06 §3）：全局格式与团队时区，不保存索引或会话。 */
export interface Manifest {
  formatVersion: number;
  applicationVersion: string;
  /** UTC RFC 3339。 */
  createdAt: string;
  timeZone: string;
}

function manifestPath(dataDir: string): string {
  return `${dataDir}/manifest.json`;
}

/** 校验 manifest 的结构性约束；不合法即损坏。 */
function assertValidManifest(value: unknown, file: string): Manifest {
  const manifest = value as Partial<Manifest>;
  if (typeof manifest.formatVersion !== "number" || typeof manifest.applicationVersion !== "string") {
    throw new StorageCorruptionError(`manifest 结构不合法：${file}`);
  }
  if (typeof manifest.createdAt !== "string" || typeof manifest.timeZone !== "string") {
    throw new StorageCorruptionError(`manifest 结构不合法：${file}`);
  }
  return manifest as Manifest;
}

/**
 * 初始化 manifest：缺失则创建 formatVersion=1 默认项；已存在则校验格式版本——
 * 比应用支持的更新时拒绝启动（06 §3），损坏时显式报错。幂等。
 * @param dataDir 数据目录根。
 * @param options 应用版本；timeZone 仅在首次创建时落盘。
 * @returns 生效的 manifest 内容。
 */
export async function initManifest(
  dataDir: string,
  options: { applicationVersion: string; timeZone?: string },
): Promise<Manifest> {
  const file = manifestPath(dataDir);
  try {
    const existing = assertValidManifest(await readJsonFile(file), file);
    if (existing.formatVersion > SUPPORTED_FORMAT_VERSION) {
      throw new UnsupportedFormatError(
        `数据格式版本 ${existing.formatVersion} 高于应用支持的 ${SUPPORTED_FORMAT_VERSION}，请先升级应用（06 §3）`,
      );
    }
    if (existing.formatVersion < SUPPORTED_FORMAT_VERSION) {
      throw new StorageCorruptionError(`manifest formatVersion ${existing.formatVersion} 异常（应 ≥ 1）`);
    }
    return existing;
  } catch (cause) {
    if (!(cause instanceof Error) || cause.name !== "EntryNotFoundError") throw cause;
  }
  const manifest: Manifest = {
    formatVersion: SUPPORTED_FORMAT_VERSION,
    applicationVersion: options.applicationVersion,
    createdAt: new Date().toISOString(),
    timeZone: options.timeZone ?? "UTC",
  };
  await writeJsonAtomic(file, manifest);
  return manifest;
}

/**
 * 读取已存在的 manifest；缺失/损坏/版本超限分别抛对应错误。
 * @param dataDir 数据目录根。
 * @returns manifest 内容。
 */
export async function readManifest(dataDir: string): Promise<Manifest> {
  const file = manifestPath(dataDir);
  const manifest = assertValidManifest(await readJsonFile(file), file);
  if (manifest.formatVersion > SUPPORTED_FORMAT_VERSION) {
    throw new UnsupportedFormatError(`数据格式版本 ${manifest.formatVersion} 高于应用支持版本（06 §3）`);
  }
  return manifest;
}
