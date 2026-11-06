import { join } from "node:path";
import { readJsonFile, writeJsonAtomic, type AtomicWriteHooks } from "./atomic-json.js";
import { getStoreContext, hasStoreDb } from "./db.js";

/** network_config / network.json 的配置形态；运行态不在这里。 */
export interface NetworkFile {
  formatVersion: number;
  shareListener: {
    enabled: boolean;
    host: string | null;
    port: number | null;
    shareBaseUrl: string | null;
  };
}

const FORMAT_VERSION = 1;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * 每次返回独立对象，避免调用方意外共享常量里的 shareListener。
 * @returns 默认 disabled 配置。
 */
export function emptyNetworkFile(): NetworkFile {
  return {
    formatVersion: FORMAT_VERSION,
    shareListener: { enabled: false, host: null, port: null, shareBaseUrl: null },
  };
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, "").replace(/\]$/, "");
}

/** 旧 network.json 的容错归一化；损坏/缺失/字段不符一律按 disabled。 */
async function readLegacyNetworkFile(dataDir: string): Promise<NetworkFile> {
  let raw: unknown;
  try {
    raw = await readJsonFile(join(dataDir, "network.json"));
  } catch {
    return emptyNetworkFile();
  }
  if (raw === null || typeof raw !== "object") return emptyNetworkFile();
  const shareListener = (raw as { shareListener?: unknown }).shareListener;
  if (shareListener === null || typeof shareListener !== "object") return emptyNetworkFile();
  const record = shareListener as { enabled?: unknown; host?: unknown; port?: unknown; shareBaseUrl?: unknown };
  const enabled = record.enabled === true;
  const host = typeof record.host === "string" && record.host.trim() !== "" ? stripBrackets(record.host) : null;
  const port =
    typeof record.port === "number" && Number.isInteger(record.port) && record.port >= MIN_PORT && record.port <= MAX_PORT
      ? record.port
      : null;
  const shareBaseUrl =
    typeof record.shareBaseUrl === "string" && record.shareBaseUrl.trim() !== ""
      ? record.shareBaseUrl.trim().replace(/\/+$/, "")
      : null;
  if (enabled && (host === null || port === null)) return emptyNetworkFile();
  return {
    formatVersion: FORMAT_VERSION,
    shareListener: { enabled, host, port, shareBaseUrl },
  };
}

/**
 * 读取网络配置：已有 SQLite 库时读 network_config；旧目录（测试/升级前）继续读 network.json。
 * 损坏配置不阻断启动。
 * @param dataDir 数据目录。
 * @returns 归一化后的配置。
 */
export async function readNetworkConfig(dataDir: string): Promise<NetworkFile> {
  if (!hasStoreDb(dataDir)) return await readLegacyNetworkFile(dataDir);
  const context = await getStoreContext(dataDir);
  const row = await context.db.selectFrom("network_config").selectAll().where("id", "=", 1).executeTakeFirst();
  if (!row) return emptyNetworkFile();
  return {
    formatVersion: row.format_version,
    shareListener: {
      enabled: row.enabled === 1,
      host: row.host,
      port: row.port,
      shareBaseUrl: row.share_base_url,
    },
  };
}

/**
 * 写入网络配置：已有 SQLite 库时 upsert network_config；旧目录继续原子写 network.json。
 * `beforeRename` 钩子在真正写入前触发，测试用它模拟保存失败。
 * @param dataDir 数据目录。
 * @param next 期望配置。
 * @param hooks 故障注入缝。
 */
export async function writeNetworkConfig(
  dataDir: string,
  next: NetworkFile,
  hooks?: AtomicWriteHooks,
): Promise<void> {
  if (!hasStoreDb(dataDir)) {
    await writeJsonAtomic(join(dataDir, "network.json"), next, hooks);
    return;
  }
  hooks?.beforeRename?.();
  const context = await getStoreContext(dataDir);
  const row = {
    id: 1,
    format_version: next.formatVersion,
    enabled: next.shareListener.enabled ? 1 : 0,
    host: next.shareListener.host,
    port: next.shareListener.port,
    share_base_url: next.shareListener.shareBaseUrl,
  };
  await context.db
    .insertInto("network_config")
    .values(row)
    .onConflict((oc) => oc.column("id").doUpdateSet(row))
    .execute();
}
