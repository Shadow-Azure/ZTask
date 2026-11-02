import { mkdir } from "node:fs/promises";
import { networkInterfaces as osNetworkInterfaces } from "node:os";
import { join } from "node:path";
import { ApiError } from "@ztask/shared";
import type { NetworkInterfaceInfo, NetworkState, ShareListenerState } from "@ztask/shared";
import { readJsonFile, writeJsonAtomic, type AtomicWriteHooks } from "../../storage/atomic-json.js";
import { isLoopbackHost, isWildcardHost } from "../../config.js";

/**
 * 动态 LAN 监听服务（01 §3、04 §9、07 §3.3）。
 *
 * 职责边界：
 * - 持久化期望配置 `network.json`（06 §3.1），不保存 socket、运行错误或网卡列表；
 * - 管理运行态（running/degraded/error）与真实 listener 句柄；
 * - 生成 `shareBaseUrl`；只有 running 时才返回值，degraded/offline 一律 null，
 *   避免向管理员或成员分发不可达地址（01 §3.1 第 5–6 条、04 §9）。
 *
 * 本模块不创建 Fastify 实例：listener 装配由 bootstrap 注入 `startListener`，
 * 测试用 fake 实现即可覆盖 bind/回滚/切换语义，不需要真实端口。
 */

/** 由 bootstrap 提供的 LAN listener 句柄；close 需等待在途请求结束（Fastify close 语义）。 */
export interface NetworkListenerHandle {
  /** 实际绑定端口；调用方以它而不是请求端口生成 shareBaseUrl。 */
  port: number;
  close(): Promise<void>;
}

/** 启动 LAN listener；host/port 已经过本服务校验。 */
export type StartNetworkListener = (host: string, port: number) => Promise<NetworkListenerHandle>;

/**
 * 06 §3.1 的 `network.json` 形态：只保存期望恢复的配置。
 * host/port/shareBaseUrl 在关闭分享后保留原值，便于管理端展示上次选择；
 * 运行态一律由 NetworkService 的内存状态回答。
 */
export interface NetworkFile {
  formatVersion: number;
  shareListener: {
    enabled: boolean;
    host: string | null;
    port: number | null;
    shareBaseUrl: string | null;
  };
}

/** 网卡原始记录的最小结构（Node `os.networkInterfaces()` 的条目）。 */
export interface RawNetworkInterface {
  address: string;
  family: string | number;
  internal: boolean;
}

/** NetworkService 装配项。 */
export interface NetworkServiceOptions {
  /** 数据目录；network.json 位于其根下。 */
  dataDir: string;
  /** loopback listener 的主机与端口（port 0 场景可用 getter 取实际端口）。 */
  loopbackHost: string;
  loopbackPort: number | (() => number);
  /**
   * 可注入时钟；network.json 与运行态都不含时间戳，此选项保留只为与其它 service
   * 的装配签名一致（bootstrap/测试可统一构造）。
   */
  clock?: () => Date;
  /** bootstrap 注入的 LAN listener 工厂。 */
  startListener: StartNetworkListener;
  /**
   * 网卡枚举缝：缺省读取 `os.networkInterfaces()` 并按 §4.1 过滤。
   * 测试注入固定列表即可覆盖「非本机地址拒绝」而不依赖真实网卡。
   */
  listInterfaces?: () => NetworkInterfaceInfo[];
  /** 原子写故障注入缝（07 §10 的网络回滚用例）。 */
  writeHooks?: AtomicWriteHooks;
}

/** 管理端可见的网络服务接口（05 §4.9）。 */
export interface NetworkService {
  /** 同步快照；未调用 restore/enable 前按 disabled 呈现。 */
  state(): NetworkState;
  /** 启动或切换 LAN listener；失败时保持旧运行态并抛出 ApiError。 */
  enable(host: string, port: number): Promise<NetworkState>;
  /** 关闭 LAN listener；先持久化 enabled=false，失败则保持原入口。 */
  disable(): Promise<NetworkState>;
  /** 启动时按 network.json 恢复；失败只标记 degraded，不抛错（04 §9）。 */
  restore(): Promise<NetworkState>;
  /** 仅 running 时返回 `http://host:port`；degraded/offline 为 null。 */
  shareBaseUrl(): string | null;
  isRunning(): boolean;
  /** 关闭运行时 listener，不修改 network.json（进程退出时使用）。 */
  close(): Promise<void>;
}

const FORMAT_VERSION = 1;
const MIN_PORT = 1;
const MAX_PORT = 65535;

/** 每次返回独立对象，避免调用方意外共享常量里的 shareListener。 */
function emptyNetworkFile(): NetworkFile {
  return {
    formatVersion: FORMAT_VERSION,
    shareListener: { enabled: false, host: null, port: null, shareBaseUrl: null },
  };
}

/** 稳定字符串比较：不用 localeCompare，避免不同环境排序漂移。 */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** URL 中的 IPv6 需要方括号；IPv4/主机名原样返回。 */
function hostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

/** URL 拼接使用的 shareBaseUrl；不做尾斜杠归一化以外的改写。 */
function buildShareBaseUrl(host: string, port: number): string {
  return `http://${hostForUrl(host)}:${port}`;
}

/** 去掉管理员可能粘贴进来的 IPv6 方括号。 */
function stripBrackets(host: string): string {
  return host.trim().replace(/^\[/, "").replace(/\]$/, "");
}

/** 地址比较：IPv6 大小写不敏感，IPv4 精确。 */
function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * 判定 IPv6 地址是否链路本地（fe80::/10）。
 * @param address 小写化前的地址串。
 * @returns 链路本地为 true。
 */
function isLinkLocalIpv6(address: string): boolean {
  return /^fe[89ab][0-9a-f]:/i.test(address);
}

/**
 * 过滤并稳定排序可选网卡地址（05 §2.3 NetworkState.interfaces、07 §3.3）：
 * - 排除 internal（含 loopback 与系统虚拟回环）；
 * - IPv4 全部保留（明确要求「非 internal 具体地址」）；
 * - IPv6 排除非 internal 的链路本地 fe80::/10；
 * - 排除 wildcard 与 loopback 兜底；
 * - 按 address 去重，最终按网卡名、地址升序，保证跨请求稳定。
 * @param records `os.networkInterfaces()` 的返回值（测试可注入固定记录）。
 * @returns 可选地址列表。
 */
export function collectShareInterfaces(records: NodeJS.Dict<RawNetworkInterface[]>): NetworkInterfaceInfo[] {
  const byAddress = new Map<string, NetworkInterfaceInfo>();
  for (const name of Object.keys(records).sort(compareText)) {
    for (const record of records[name] ?? []) {
      if (record.internal) continue;
      const address = record.address.trim();
      if (address === "") continue;
      const family = typeof record.family === "string" ? record.family : record.family === 4 ? "IPv4" : "IPv6";
      if (family === "IPv6") {
        if (address === "::1" || address === "::" || isLinkLocalIpv6(address)) continue;
      } else if (family === "IPv4") {
        if (address === "0.0.0.0") continue;
      } else {
        continue;
      }
      if (isWildcardHost(address) || isLoopbackHost(address)) continue;
      const key = address.toLowerCase();
      // 同一地址可能同时挂在多个别名网卡上：保留名字最小的一条，避免 UI 出现重复项。
      if (byAddress.has(key)) continue;
      byAddress.set(key, { name, address });
    }
  }
  return [...byAddress.values()].sort((a, b) => compareText(a.name, b.name) || compareText(a.address, b.address));
}

/**
 * 读取 network.json 并做容错归一化：文件缺失、JSON 损坏、字段类型不符都视为 disabled，
 * 绝不因网络配置损坏阻断启动（01 §3.1、06 §3.1）。
 * @param dataDir 数据目录。
 * @returns 归一化后的配置；永不为 null。
 */
async function readNetworkFile(dataDir: string): Promise<NetworkFile> {
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
    typeof record.shareBaseUrl === "string" && record.shareBaseUrl.trim() !== "" ? record.shareBaseUrl.trim().replace(/\/+$/, "") : null;
  // enabled 但缺少可恢复的 host/port：配置不可执行，按 disabled 呈现而不是假装 degraded。
  if (enabled && (host === null || port === null)) return emptyNetworkFile();
  return {
    formatVersion: FORMAT_VERSION,
    shareListener: { enabled, host, port, shareBaseUrl },
  };
}

/** 运行时 listener 与请求地址记录。 */
interface ActiveListener {
  host: string;
  port: number;
  handle: NetworkListenerHandle;
}

/**
 * 创建网络服务（07 §3.3）。
 * @param options 数据目录、loopback 地址、listener 工厂与测试缝。
 * @returns NetworkService。
 */
export function createNetworkService(options: NetworkServiceOptions): NetworkService {
  const listInterfaces = options.listInterfaces ?? (() => collectShareInterfaces(osNetworkInterfaces()));

  let persisted: NetworkFile = emptyNetworkFile();
  let loaded = false;
  let active: ActiveListener | null = null;
  let degraded = false;
  let lastError: string | null = null;

  // enable/disable/restore 共享同一串行队列：并发调用不会出现「两个 listener 都登记为当前」的竞态。
  let tail: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task, task);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function loopbackPort(): number {
    return typeof options.loopbackPort === "function" ? options.loopbackPort() : options.loopbackPort;
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    persisted = await readNetworkFile(options.dataDir);
    loaded = true;
  }

  async function persist(next: NetworkFile): Promise<void> {
    await mkdir(options.dataDir, { recursive: true, mode: 0o700 });
    await writeJsonAtomic(join(options.dataDir, "network.json"), next, options.writeHooks);
  }

  async function closeQuietly(handle: NetworkListenerHandle): Promise<void> {
    try {
      await handle.close();
    } catch {
      // 关闭旧入口失败不改变已提交的配置；listener 进程退出时会释放端口。
    }
  }

  function state(): NetworkState {
    const shareListener: ShareListenerState = {
      enabled: persisted.shareListener.enabled,
      running: active !== null,
      // degraded 只描述「配置要求开启但本次启动失败」；用户主动关闭后不再显示 degraded。
      degraded: degraded && active === null,
      host: active?.host ?? persisted.shareListener.host ?? null,
      port: active?.port ?? persisted.shareListener.port ?? null,
      shareBaseUrl: active ? buildShareBaseUrl(active.host, active.port) : null,
      error: active === null && degraded ? lastError : null,
    };
    return {
      loopbackUrl: buildShareBaseUrl(options.loopbackHost, loopbackPort()),
      interfaces: listInterfaces(),
      shareListener,
    };
  }

  /** 422 统一出口：所有 host/port 校验失败都使用 LAN_INTERFACE_INVALID（05 §7）。 */
  function invalidInterface(message: string): ApiError {
    return new ApiError(422, "LAN_INTERFACE_INVALID", message);
  }

  function validateHost(rawHost: string): string {
    const host = stripBrackets(rawHost);
    if (host === "" || isWildcardHost(host) || isLoopbackHost(host)) {
      throw invalidInterface("分享监听地址必须是本机具体的局域网地址，不能是回环或通配地址");
    }
    const available = listInterfaces();
    const match = available.find((entry) => sameAddress(entry.address, host));
    if (!match) {
      throw invalidInterface("该地址不是当前服务主机的可用局域网地址");
    }
    return match.address;
  }

  function validatePort(port: number): number {
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
      throw invalidInterface(`分享监听端口非法：须为 ${MIN_PORT}–${MAX_PORT} 的整数`);
    }
    return port;
  }

  return {
    state,

    async enable(rawHost, rawPort) {
      return await serial(async () => {
        await ensureLoaded();
        const host = validateHost(rawHost);
        const port = validatePort(rawPort);

        // 已按要求运行：不重复 bind，直接返回当前事实（05 §4.9 幂等）。
        if (active !== null && sameAddress(active.host, host) && active.port === port) return state();

        let handle: NetworkListenerHandle;
        try {
          handle = await options.startListener(host, port);
        } catch {
          // bind 失败不写 network.json、不改变旧运行态；错误体只给脱敏原因（04 §9）。
          throw invalidInterface("无法在该地址启动分享监听：地址当前不可用或端口已被占用");
        }

        const actualPort = Number.isInteger(handle.port) && handle.port > 0 ? handle.port : port;
        const next: NetworkFile = {
          formatVersion: FORMAT_VERSION,
          shareListener: {
            enabled: true,
            host,
            port: actualPort,
            shareBaseUrl: buildShareBaseUrl(host, actualPort),
          },
        };

        try {
          await persist(next);
        } catch {
          // 04 §9 / 07 §3.3：配置保存失败只关闭刚启动的新入口，旧入口继续服务。
          await closeQuietly(handle);
          throw new ApiError(500, "INTERNAL_ERROR", "无法保存网络配置，分享监听未启用");
        }

        const previous = active;
        active = { host, port: actualPort, handle };
        persisted = next;
        degraded = false;
        lastError = null;
        if (previous !== null) await closeQuietly(previous.handle);
        return state();
      });
    },

    async disable() {
      return await serial(async () => {
        await ensureLoaded();
        if (active === null && !persisted.shareListener.enabled) return state();

        const previous = active;
        const next: NetworkFile = {
          formatVersion: FORMAT_VERSION,
          // 保留 host/port/shareBaseUrl 便于管理端展示上次选择；enabled=false 才是恢复语义。
          shareListener: {
            enabled: false,
            host: previous?.host ?? persisted.shareListener.host,
            port: previous?.port ?? persisted.shareListener.port,
            shareBaseUrl: previous !== null ? buildShareBaseUrl(previous.host, previous.port) : persisted.shareListener.shareBaseUrl,
          },
        };

        try {
          await persist(next);
        } catch {
          // 先保存再断流：写失败必须保持原入口运行，且不吊销 token/session（04 §9）。
          throw new ApiError(500, "INTERNAL_ERROR", "无法保存网络配置，分享监听保持运行");
        }

        persisted = next;
        active = null;
        degraded = false;
        lastError = null;
        if (previous !== null) await closeQuietly(previous.handle);
        return state();
      });
    },

    async restore() {
      return await serial(async () => {
        await ensureLoaded();
        if (active !== null) return state();
        const saved = persisted.shareListener;
        if (!saved.enabled || saved.host === null || saved.port === null) {
          degraded = false;
          lastError = null;
          return state();
        }
        try {
          const handle = await options.startListener(saved.host, saved.port);
          const actualPort = Number.isInteger(handle.port) && handle.port > 0 ? handle.port : saved.port;
          active = { host: saved.host, port: actualPort, handle };
          degraded = false;
          lastError = null;
        } catch {
          // 重启恢复失败只影响分享：loopback 管理端继续可用，状态标记 degraded（04 §9）。
          active = null;
          degraded = true;
          lastError = "局域网监听恢复失败：保存的地址当前不可用或端口被占用";
        }
        return state();
      });
    },

    shareBaseUrl(): string | null {
      return active === null ? null : buildShareBaseUrl(active.host, active.port);
    },

    isRunning(): boolean {
      return active !== null;
    },

    async close() {
      await serial(async () => {
        const previous = active;
        active = null;
        if (previous !== null) await closeQuietly(previous.handle);
      });
    },
  };
}
