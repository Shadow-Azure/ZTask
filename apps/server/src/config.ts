import { homedir } from "node:os";
import path from "node:path";

/**
 * 服务启动配置（07 §1 bootstrap 的输入）。
 * host/port/dataDir 经 validateServeConfig 归一化；staticRoot 为生产态 Vue 构建产物目录。
 */
export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  staticRoot: string | null;
}

/** CLI/测试传入的原始配置；字段缺省时按默认规则补齐。 */
export interface ServeConfigInput {
  host?: string;
  port?: number;
  dataDir?: string;
  staticRoot?: string | null;
}

/**
 * 数据目录默认值：`ZTASK_HOME` 优先，否则 `~/.ztask`（01 §3 配置表）。
 * @param env 进程环境变量，测试可注入替代品。
 * @returns 数据目录绝对路径。
 */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.ZTASK_HOME?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(homedir(), ".ztask");
}

/**
 * 判定 host 是否为 wildcard（0.0.0.0 / :: / 空串）。wildcard 不允许作为监听地址。
 * @param host 待判定主机名。
 */
export function isWildcardHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "" || normalized === "0.0.0.0" || normalized === "::";
}

/**
 * 判定 host 是否为 loopback（localhost / 127.0.0.0/8 / ::1 / IPv4 映射 loopback）。
 * @param host 待判定主机名。
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("::ffff:127.")
  );
}

/**
 * 校验并归一化启动配置：拒绝 wildcard 监听与越界端口；port 0 仅允许 loopback（01 §3）。
 * @param input CLI/测试的原始配置。
 * @returns 归一化后的 ServerConfig。
 * @throws Error 配置非法（wildcard host、端口越界、空 dataDir）时抛出。
 */
export function validateServeConfig(input: ServeConfigInput): ServerConfig {
  const host = input.host?.trim() || "127.0.0.1";
  if (isWildcardHost(host)) {
    throw new Error(`拒绝 wildcard 监听地址 ${host}：默认只允许 loopback，LAN 需显式具体 IP（01 §3）`);
  }

  const port = input.port ?? 8123;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`端口非法：${String(input.port)}（须为 0–65535 整数）`);
  }
  if (port === 0 && !isLoopbackHost(host)) {
    throw new Error("port 0 仅用于 loopback 测试（01 §3）");
  }

  const trimmedDataDir = input.dataDir?.trim();
  if (trimmedDataDir === "") {
    throw new Error("dataDir 不能为空");
  }
  const dataDir = trimmedDataDir || defaultDataDir();

  const staticRoot = input.staticRoot?.trim() || null;
  return { host, port, dataDir, staticRoot };
}
