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
import { networkRoutes } from "./modules/network/network-routes.js";
import { shareLinkRoutes } from "./modules/share/share-link-routes.js";
import type { NetworkService } from "./modules/network/network-service.js";
import type { ShareLinkService } from "./modules/share/share-links.js";

/** 请求入口类型；loopback 入口可访问 Admin API，LAN 入口一律拒绝（04 §4.1）。 */
export type ListenerKind = "loopback" | "lan";

/** buildApp 的可选装配参数；测试与生产共用同一装配（07 §1）。 */
export interface BuildAppOptions {
  listenerKind?: ListenerKind;
  /** 健康检查里回显的服务版本；缺省 "0.0.0"。 */
  version?: string;
  /** 存储门面；提供后挂接管理端业务路由（folders/members）。 */
  store?: ZtaskStore;
  /** 网络服务；提供后挂接 /admin/network（05 §4.9）。LAN app 同样注册，由 Admin 守卫拒绝。 */
  networkService?: NetworkService;
  /** 分享链接服务；提供后挂接 /admin/members/{id}/share-link（05 §4.5–4.8）。 */
  shareLinkService?: ShareLinkService;
}

declare module "fastify" {
  export interface FastifyRequest {
    listenerKind: ListenerKind;
  }
}

/**
 * 统一 CSP（04 §8「合理 CSP」、08 §5）：静态壳与 API 同源，不加载第三方脚本。
 *
 * - `script-src 'self'`：Vite 产物只有外链 module，没有内联脚本；
 * - `style-src 'self' 'unsafe-inline'`：Vue 组件用 `:style` 绑定行内样式（头像色、进度宽度、
 *   树缩进），不能用 nonce 拆分，故显式放开行内样式而不放开脚本；
 * - `connect-src 'self'`：所有请求走同源 `/api/v1`，不同源即失败；
 * - `frame-ancestors 'none'` + `base-uri 'self'` + `form-action 'self'`：禁止被套壳与 base 劫持。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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

  // 安全响应头（04 §8）：token 只在 fragment 里是浏览器语义，不是服务端保证；
  // 这里给所有响应（含静态、404、错误体）补上兜底，避免来源 URL 进入 Referer。
  // 必须早于任何路由注册，才能被之后注册的插件（静态/管理端/share）继承。
  // CSP 在此补齐（#20 LAN 上线前）：LAN 分享域与同一静态壳共用这份策略。
  app.addHook("onSend", async (_request, reply) => {
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", CONTENT_SECURITY_POLICY);
  });

  // Admin 本机专用守卫（04 §4.1）：必须在注册任何业务路由之前安装。
  // 原因同下方 errorHandler 注释——`await app.register()` 会推进 avvio boot，
  // 插件路由在 boot 时把当时的 hook 链固化进路由上下文；之后再 addHook 不会回溯。
  // 若把守卫放在路由注册之后，LAN app 上的 /admin/* 会先命中路由而绕过 403，
  // 直接破坏「LAN listener 一律拒绝 Admin API」这条红线。
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

  // 错误与 404 序列化器必须在任何 `await app.register(...)` 之前安装（§6.3）。
  // 真实机制不是「注册路由那一刻快照」，而是：`await app.register()` 会推进 avvio 的
  // boot，插件路由所在上下文在该实例 boot 完成时就已把当时的 errorHandler 固化进
  // 路由上下文（fastify `lib/route.js` 的 after 回调）；之后再 setErrorHandler
  // 不会回溯已注册路由，插件作用域会退化为 Fastify 默认错误体
  // （05 §7 要求统一的嵌套 error 结构，管理端抛出的 ApiError 同样走这里）。
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

  await app.register(cookie);

  if (config.staticRoot) {
    // wildcard:false：只精确服务真实文件，未命中路径统一交给下方 notFoundHandler 做 SPA 回退。
    await app.register(fastifyStatic, { root: config.staticRoot, wildcard: false });
  }

  if (options.store) {
    // 管理端业务路由（#15/#16）；Admin 本机专用守卫已在路由注册前安装。
    await app.register(folderRoutes, { dataDir: config.dataDir });
    await app.register(memberRoutes, { dataDir: config.dataDir, shareLinkService: options.shareLinkService });
    await app.register(taskRoutes, { dataDir: config.dataDir });
    await app.register(shareRoutes, { dataDir: config.dataDir });
  }

  // 网络与分享链接管理（#20）：两个服务由 bootstrap 创建，loopback 与 LAN app 共享同一实例；
  // LAN app 也注册它们，以便 Admin 守卫对越权请求返回 403 ADMIN_LOCAL_ONLY 而不是 404。
  if (options.networkService) {
    await app.register(networkRoutes, { service: options.networkService });
  }
  if (options.shareLinkService) {
    await app.register(shareLinkRoutes, { service: options.shareLinkService });
  }

  app.get(`${API_PREFIX}/health`, async () => ({
    status: "ok" as const,
    version,
    // 进程口径（与 HealthPayload 注释一致）：同一进程内重复 buildApp 不会让数值回跳。
    uptimeSeconds: Math.floor(process.uptime()),
  }));

  return app;
}
