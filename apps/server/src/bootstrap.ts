import type { FastifyInstance } from "fastify";
import { buildApp, type BuildAppOptions } from "./app.js";
import type { ServerConfig } from "./config.js";
import { acquireDataDirLock, type DataDirLock } from "./lock.js";

/** serve() 的返回句柄；close 幂等，SIGINT/SIGTERM 由 CLI 转换为 close。 */
export interface ServeHandle {
  app: FastifyInstance;
  /** 实际绑定端口（port 0 时由内核分配）。 */
  port: number;
  /** 关闭 HTTP 服务并释放数据目录锁；重复调用安全。 */
  close(): Promise<void>;
}

/**
 * 启动顺序遵循 07 §1：先取数据目录单写者锁，再装配并监听。
 * 本 issue 覆盖 loopback 监听与生命周期；LAN 恢复、store 迁移由后续 issue 按同一顺序扩展。
 * @param config 归一化后的服务配置。
 * @param options 装配选项（listenerKind 恒为 loopback）。
 * @returns ServeHandle。
 * @throws LockHeldError 数据目录被占用；监听失败时释放锁后原样抛出。
 */
export async function serve(config: ServerConfig, options: BuildAppOptions = {}): Promise<ServeHandle> {
  const lock: DataDirLock = await acquireDataDirLock(config.dataDir);
  let closed = false;

  try {
    const app = await buildApp(config, { listenerKind: "loopback", ...options });
    await app.listen({ host: config.host, port: config.port });

    return {
      app,
      port: resolvePort(app),
      async close(): Promise<void> {
        if (closed) return;
        closed = true;
        await app.close();
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
