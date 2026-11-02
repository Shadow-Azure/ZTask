import type { FastifyInstance } from "fastify";
import { buildApp, type BuildAppOptions } from "./app.js";
import type { ServerConfig } from "./config.js";
import { acquireDataDirLock, type DataDirLock } from "./lock.js";
import { initStore, type ZtaskStore } from "./storage/store.js";

/** serve() 的返回句柄；close 幂等，SIGINT/SIGTERM 由 CLI 转换为 close。 */
export interface ServeHandle {
  app: FastifyInstance;
  /** 实际绑定端口（port 0 时由内核分配）。 */
  port: number;
  /** 已完成恢复与索引构建的存储门面；业务路由由后续 issue 挂接。 */
  store: ZtaskStore;
  /** 关闭 HTTP 服务、排空写队列并释放数据目录锁；重复调用安全。 */
  close(): Promise<void>;
}

/**
 * 启动顺序遵循 07 §1：数据目录单写者锁 → 存储恢复与索引 → 装配并监听 loopback。
 * LAN 恢复、migration 的更多步骤由后续 issue 按同一顺序扩展。
 * @param config 归一化后的服务配置。
 * @param options 装配选项（listenerKind 恒为 loopback；version 兼作 manifest 应用版本）。
 * @returns ServeHandle。
 * @throws LockHeldError 数据目录被占用；存储恢复失败或监听失败时释放锁后原样抛出。
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
    const app = await buildApp(config, { listenerKind: "loopback", ...options });
    await app.listen({ host: config.host, port: config.port });

    return {
      app,
      port: resolvePort(app),
      store,
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await app.close();
        await store.drain();
        await lock.release();
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
