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
import { createDashboardService } from "./modules/dashboard/dashboard-service.js";
import { dashboardRoutes } from "./modules/dashboard/dashboard-routes.js";
import { createHistoryService } from "./modules/revisions/history-service.js";
import type { NetworkService } from "./modules/network/network-service.js";
import type { ShareLinkService } from "./modules/share/share-links.js";
import { maintenanceRoutes } from "./modules/maintenance/maintenance-routes.js";
import type { BackupHooks } from "./modules/maintenance/backup-service.js";

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
  /**
   * 看板/历史服务的可注入时钟（测试固定「今天/昨天」与 now）；缺省系统时间。
   * 写入侧 revision 的 recordedAt 由 TaskStore 的 clock 决定，需要确定性时两者应注入同一时钟。
   */
  clock?: () => Date;
  /**
   * 在线备份故障注入缝（#23 测试用）：模拟「发布前崩溃」与「备份进行中」的并发窗口；
   * 生产不传。备份服务仍需 store.pauseWrites 建立一致性边界。
   */
  backupHooks?: BackupHooks;
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

/** 产生副作用的 HTTP 方法；GET/HEAD/OPTIONS 不做同源 mutation 校验。 */
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const ADMIN_PATH_PREFIX = `${API_PREFIX}/admin`;

/**
 * 判定一个已解码路径是否落在 Admin API 命名空间。
 * @param path 已解码的路径（路由模板或 pathname）。
 * @returns 是否属于 Admin API。
 */
function isAdminPath(path: string): boolean {
  return path === ADMIN_PATH_PREFIX || path.startsWith(`${ADMIN_PATH_PREFIX}/`);
}

/**
 * 取出请求路径并做与 Fastify 路由一致的「一次百分号解码」。
 *
 * 守卫绝不能只看 `request.raw.url`：它保留编码，而 fastify 路由匹配解码后的段，
 * `/api/v1/%61dmin/members` 会通过前缀比较却又命中 admin 路由 → LAN 提权。
 * 这里对 404 场景单次 decodeURIComponent（与路由解码次数一致）；二次编码
 * `%2561dmin` 解码后仍是 `%61dmin`，不会命中 admin 路由，保持 404。
 * @param rawUrl 原始请求 URL。
 * @returns 解码后的 pathname。
 */
function decodedPathname(rawUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://placeholder").pathname;
  } catch {
    pathname = rawUrl;
  }
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

/**
 * 判断请求是否命中 Admin 路由：优先用 fastify 已匹配的路由模板（与注册表一致），
 * 未命中路由时回退到解码后的 pathname。
 * @param request Fastify 请求。
 * @returns true 表示应按 Admin 规则校验。
 */
function isAdminRequest(request: FastifyRequest): boolean {
  const routeUrl = request.routeOptions.url;
  if (typeof routeUrl === "string" && routeUrl !== "") return isAdminPath(routeUrl);
  return isAdminPath(decodedPathname(request.raw.url ?? "/"));
}

/**
 * 提取 Host 的 hostname 部分（去掉端口与 IPv6 方括号）。
 * @param host Host 头。
 * @returns 小写 hostname。
 */
function hostnameOf(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host.toLowerCase() : host.slice(1, end).toLowerCase();
  }
  return host.split(":")[0]!.toLowerCase();
}

/**
 * Admin 请求的 Host 白名单（防 DNS rebinding）。
 *
 * 「对端是 loopback」不足以证明请求来自管理员浏览器：DNS rebinding 会让
 * `attacker.example` 解析到 127.0.0.1，此时 remoteAddress 仍是 loopback。
 * 因此 Admin API 额外要求 Host 是本机回环名或服务实际绑定的主机名。
 * @param host Host 头。
 * @param configuredHost 服务绑定的 host。
 * @returns true 表示 Host 可信。
 */
function isTrustedAdminHost(host: string | undefined, configuredHost: string): boolean {
  if (host === undefined) return false;
  const name = hostnameOf(host);
  return name === "127.0.0.1" || name === "localhost" || name === "::1" || name === configuredHost.toLowerCase();
}

/**
 * 同源 mutation 校验（04 §8「mutation 检查 Origin/Fetch-Site」）。
 *
 * 浏览器对非 GET 请求会带 `Origin`；跨站表单/fetch 无法伪造 Host，因此
 * `Origin.host === Host` 即证明请求来自同源页面。没有 `Origin` 的请求来自
 * curl/CLI/自动化测试（非浏览器），不构成 CSRF 面。
 * `Sec-Fetch-Site` 缺省（旧浏览器/非浏览器）时以 Origin 结论为准。
 * @param request Fastify 请求。
 * @returns true 表示可执行该 mutation。
 */
function isSameOriginMutation(request: FastifyRequest): boolean {
  const host = request.headers.host;
  if (host === undefined) return false;
  // Sec-Fetch-Site 是浏览器声明的「发起方与目标关系」，比 Origin 更贴近实际来源：
  // 即使 Origin 与 Host 恰好相同（DNS rebinding 场景），cross-site 也必须拒绝。
  const site = request.headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    // `Origin: null`（沙箱 iframe 等）无法解析，一律拒绝。
    return false;
  }
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
    // 05 §1/§8「请求 schema 默认拒绝未声明字段」：ajv 默认 removeAdditional=true 会
    // 静默剥离未知字段并回 200，与契约相反；显式关闭后 additionalProperties:false
    // 才会产生 400 INVALID_REQUEST。
    ajv: { customOptions: { removeAdditional: false } },
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

  // 同源 mutation 校验（04 §8）：必须早于路由注册，才能被所有后续插件继承。
  // 重点保护无 body schema 的 POST/DELETE（如分享链接生成/重置/吊销），
  // 跨站表单无法被「Content-Type: application/json」挡住。
  app.addHook("preHandler", async (request, reply) => {
    if (!MUTATION_METHODS.has(request.method)) return;
    if (isSameOriginMutation(request)) return;
    await reply.status(403).send({
      error: {
        code: "CROSS_SITE_REQUEST",
        message: "跨站写请求已被拒绝",
        requestId: request.id,
      },
    });
  });

  // Admin 本机专用守卫（04 §4.1）：必须在注册任何业务路由之前安装。
  // 原因同下方 errorHandler 注释——`await app.register()` 会推进 avvio boot，
  // 插件路由在 boot 时把当时的 hook 链固化进路由上下文；之后再 addHook 不会回溯。
  // 若把守卫放在路由注册之后，LAN app 上的 /admin/* 会先命中路由而绕过 403，
  // 直接破坏「LAN listener 一律拒绝 Admin API」这条红线。
  //
  // 路径判定必须用「解码后的路由模板」而不是 `raw.url`：`/api/v1/%61dmin/members`
  // 在 raw.url 上不以 `/api/v1/admin` 开头，却会被 fastify 解码后命中 admin 路由。
  // Host 白名单补上 DNS rebinding 的一半缺失：对端是 loopback 不等于页面就是本机。
  app.addHook("preHandler", async (request, reply) => {
    if (!isAdminRequest(request)) return;
    const localAdmin =
      request.listenerKind === "loopback" &&
      isLoopbackRemote(request.socket.remoteAddress) &&
      isTrustedAdminHost(request.headers.host, config.host);
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
    // 看板/历史服务按 manifest 时区求「今天」与本地日期边界（05 §5.2–5.3）；
    // 管理员与分享域共享同一实例，保证两边口径一致。
    const dashboardService = createDashboardService({
      dataDir: config.dataDir,
      timeZone: options.store.manifest.timeZone,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    const historyService = createHistoryService({
      dataDir: config.dataDir,
      timeZone: options.store.manifest.timeZone,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    // 管理端业务路由（#15/#16）；Admin 本机专用守卫已在路由注册前安装。
    await app.register(folderRoutes, { dataDir: config.dataDir });
    await app.register(memberRoutes, { dataDir: config.dataDir, shareLinkService: options.shareLinkService });
    // 管理端与成员写共用同一 TaskStore/串行队列（06 §8.2）：否则两条队列会把
    // 同 expectedVersion 的并发提交都判成功，造成丢写甚至 revisionTip 损坏。
    await app.register(taskRoutes, { dataDir: config.dataDir, taskStore: options.store.tasks });
    await app.register(dashboardRoutes, { service: dashboardService, historyService });
    await app.register(shareRoutes, {
      dataDir: config.dataDir,
      taskStore: options.store.tasks,
      dashboardService,
      historyService,
    });
    // 在线备份（#23）：Admin 本机专用守卫已就位；备份通过 store.pauseWrites 暂停写入。
    // appVersion 取调用方声明的服务版本，缺省回落到 manifest 里写入数据的应用版本。
    await app.register(maintenanceRoutes, {
      dataDir: config.dataDir,
      appVersion: options.version ?? options.store.manifest.applicationVersion,
      store: options.store,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.backupHooks === undefined ? {} : { backupHooks: options.backupHooks }),
    });
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
