import type { FastifyInstance } from "fastify";
import { buildApp, type BuildAppOptions } from "./app.js";
import type { ServerConfig } from "./config.js";
import { acquireDataDirLock, type DataDirLock } from "./lock.js";
import { createNetworkService, type NetworkListenerHandle, type NetworkService } from "./modules/network/network-service.js";
import { createShareLinkService, type ShareLinkService } from "./modules/share/share-links.js";
import { initStore, type ZtaskStore } from "./storage/store.js";

/** serve() 的返回句柄；close 幂等，SIGINT/SIGTERM 由 CLI 转换为 close。 */
export interface ServeHandle {
  app: FastifyInstance;
  /** 实际绑定端口（port 0 时由内核分配）。 */
  port: number;
  /** 已完成恢复与索引构建的存储门面；loopback 与 LAN listener 共用同一实例。 */
  store: ZtaskStore;
  /** 动态 LAN 监听服务：CLI 用它输出分享状态，管理端用它启停（07 §3.3）。 */
  networkService: NetworkService;
  /** 分享链接生命周期服务：与管理端路由共享同一实例（05 §4.5–4.8）。 */
  shareLinkService: ShareLinkService;
  /**
   * `--lan` 启动尝试的脱敏失败原因；null 表示未指定、已运行或成功。
   * 失败不阻止 loopback 启动，CLI 据此打印「分享未开启」而不是伪称可用（04 §9）。
   */
  lanError: string | null;
  /** 关闭 HTTP 服务、排空写队列并释放数据目录锁；重复调用安全。 */
  close(): Promise<void>;
}

/**
 * 启动顺序遵循 07 §1：数据目录单写者锁 → 存储恢复与索引 → 装配共享 Service →
 * 启动 loopback listener → 按 network.json/--lan 尝试恢复 LAN listener。
 *
 * 两个 listener 共享同一 `ZtaskStore`、`NetworkService` 与 `ShareLinkService`：
 * - loopback app 先启动并注册全量路由（含 Admin）；
 * - LAN app 由 NetworkService 的 startListener 回调在需要时创建，标记 listenerKind=lan，
 *   复用同一服务实例，Admin 路由由统一守卫拒绝（04 §4.1）。
 *
 * @param config 归一化后的服务配置。
 * @param options 装配选项（listenerKind 恒为 loopback；version 兼作 manifest 应用版本）。
 * @returns ServeHandle。
 * @throws LockHeldError 数据目录被占用；存储恢复失败或 loopback 监听失败时释放锁后原样抛出。
 */
export async function serve(config: ServerConfig, options: BuildAppOptions = {}): Promise<ServeHandle> {
  const lock: DataDirLock = await acquireDataDirLock(config.dataDir);
  let closed = false;

  try {
    // 07 §1 顺序：锁 → manifest/恢复/索引 → HTTP 装配。存储不可用则不开放 API。
    const store = await initStore({
      dataDir: config.dataDir,
      applicationVersion: options.version ?? "0.0.0",
    });

    // 分享链接服务先建：它只通过可变 holder 读取网络状态，避免与 LAN listener 的装配循环依赖。
    const holder: { network: NetworkService | null } = { network: null };
    const shareLinkService = createShareLinkService({
      dataDir: config.dataDir,
      network: {
        isRunning: () => holder.network?.isRunning() ?? false,
        shareBaseUrl: () => holder.network?.shareBaseUrl() ?? null,
      },
    });

    // loopback 实际端口在 listen 之后才知道（port 0 测试场景），因此用 getter 延迟读取。
    let boundLoopbackPort: number | null = null;

    const networkService = createNetworkService({
      dataDir: config.dataDir,
      loopbackHost: config.host,
      loopbackPort: () => boundLoopbackPort ?? config.port,
      startListener: async (host, port): Promise<NetworkListenerHandle> => {
        // 每个 LAN listener 都是独立 Fastify 实例，但共享同一 store/services，
        // 不是第二个 ZTask 进程（01 §2）。
        const lanApp = await buildApp(config, {
          version: options.version,
          store,
          listenerKind: "lan",
          networkService: holder.network ?? undefined,
          shareLinkService,
        });
        await lanApp.listen({ host, port });
        return {
          port: resolvePort(lanApp),
          close: () => lanApp.close(),
        };
      },
    });
    holder.network = networkService;

    const app = await buildApp(config, {
      ...options,
      listenerKind: "loopback",
      store,
      networkService,
      shareLinkService,
    });
    await app.listen({ host: config.host, port: config.port });
    boundLoopbackPort = resolvePort(app);
    const loopbackPort = boundLoopbackPort;

    // loopback 已可用才恢复 LAN：恢复失败只标记 degraded（04 §9）。
    await networkService.restore();

    let lanError: string | null = null;
    if (config.lanHost) {
      try {
        await networkService.enable(config.lanHost, loopbackPort);
      } catch (cause) {
        // 04 §9：LAN 启动失败不影响本机管理端；错误已由 service 脱敏。
        lanError = cause instanceof Error ? cause.message : "局域网监听未启动";
      }
    }

    return {
      app,
      port: loopbackPort,
      store,
      networkService,
      shareLinkService,
      lanError,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        try {
          // 关闭顺序（04 §9）：先关 LAN 入口（不改 network.json，重启仍恢复），
          // 再关 loopback、排空写队列、释放锁。
          await networkService.close();
        } finally {
          try {
            await app.close();
          } finally {
            try {
              await store.drain();
            } finally {
              await lock.release();
            }
          }
        }
      },
    };
  } catch (cause) {
    await lock.release();
    throw cause;
  }
}

function resolvePort(app: FastifyInstance): number {
  const address = app.server.address();
  if (address !== null && typeof address === "object") return address.port;
  throw new Error("监听地址尚未就绪");
}
