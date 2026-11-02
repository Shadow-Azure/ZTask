import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from "fastify";
import { API_PREFIX, ApiError } from "@ztask/shared";
import type { ServerConfig } from "./config.js";
import { isLoopbackHost } from "./config.js";
import type { ZtaskStore } from "./storage/store.js";
import { folderRoutes } from "./modules/folders/folder-routes.js";
import { memberRoutes } from "./modules/members/member-routes.js";
import { taskRoutes } from "./modules/tasks/task-routes.js";
import { shareRoutes } from "./modules/share/share-routes.js";

/** 请求入口类型；LAN 监听本体由后续 issue 装配，本 issue 先固定标记与 Admin 拒绝钩子。 */
export type ListenerKind = "loopback" | "lan";

/** buildApp 的可选装配参数；测试与生产共用同一装配（07 §1）。 */
export interface BuildAppOptions {
  listenerKind?: ListenerKind;
  /** 健康检查里回显的服务版本；缺省 "0.0.0"。 */
  version?: string;
  /** 存储门面；提供后挂接管理端业务路由（folders/members）。 */
  store?: ZtaskStore;
}

declare module "fastify" {
  export interface FastifyRequest {
    listenerKind: ListenerKind;
  }
}

function isLoopbackRemote(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && isLoopbackHost(remoteAddress);
}

/**
 * 装配 Fastify 应用：/api/v1 健康、统一 404、同源静态回退与 Admin 本机专用钩子。
 * /api/* 未命中返回统一 404 JSON，静态回退绝不吞掉 API（验收标准）。
 * @param config 归一化后的服务配置。
 * @param options listenerKind 与版本等装配选项。
 * @returns 未监听的 Fastify 实例（调用方负责 listen/close）。
 */
export async function buildApp(config: ServerConfig, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const listenerKind: ListenerKind = options.listenerKind ?? "loopback";
  const version = options.version ?? "0.0.0";

  const app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
  });
  app.decorateRequest("listenerKind", "loopback");
  app.addHook("onRequest", async (request: FastifyRequest) => {
    request.listenerKind = listenerKind;
  });

  await app.register(cookie);

  if (config.staticRoot) {
    // wildcard:false：只精确服务真实文件，未命中路径统一交给下方 notFoundHandler 做 SPA 回退。
    await app.register(fastifyStatic, { root: config.staticRoot, wildcard: false });
  }

  if (options.store) {
    // 管理端业务路由（#15/#16）；Admin 本机专用守卫仍由下方 preHandler 统一执行。
    await app.register(folderRoutes, { dataDir: config.dataDir });
    await app.register(memberRoutes, { dataDir: config.dataDir });
    await app.register(taskRoutes, { dataDir: config.dataDir });
    await app.register(shareRoutes, { dataDir: config.dataDir });
  }

  app.addHook("preHandler", async (request, reply) => {
    const url = request.raw.url ?? "/";
    if (!url.startsWith(`${API_PREFIX}/admin`)) return;
    const localAdmin = request.listenerKind === "loopback" && isLoopbackRemote(request.socket.remoteAddress);
    if (!localAdmin) {
      await reply.status(403).send({
        error: {
          code: "ADMIN_LOCAL_ONLY",
          message: "管理 API 仅允许从服务主机本机访问",
          requestId: request.id,
        },
      });
    }
  });

  app.get(`${API_PREFIX}/health`, async () => ({
    status: "ok" as const,
    version,
    // 进程口径（与 HealthPayload 注释一致）：同一进程内重复 buildApp 不会让数值回跳。
    uptimeSeconds: Math.floor(process.uptime()),
  }));

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id, details: error.details },
      });
      return;
    }
    if (error.validation) {
      void reply.status(400).send({
        error: { code: "INVALID_REQUEST", message: error.message, requestId: request.id },
      });
      return;
    }
    const statusCode = error.statusCode ?? 500;
    const safe = statusCode >= 500;
    void reply.status(statusCode).send({
      error: {
        code: safe ? "INTERNAL_ERROR" : "INVALID_REQUEST",
        message: safe ? "内部错误" : error.message,
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    const url = request.raw.url ?? "/";
    if (url.startsWith("/api/")) {
      void reply.status(404).send({
        error: { code: "NOT_FOUND", message: `未知 API 路由：${url}`, requestId: request.id },
      });
      return;
    }
    if (config.staticRoot) {
      void reply.sendFile("index.html");
      return;
    }
    void reply.status(404).type("text/plain; charset=utf-8").send("not found");
  });

  return app;
}
