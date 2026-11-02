import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ApiError,
  type Importance,
  type ShareHomeTasks,
  type ShareSessionResponse,
  type ShareTaskDetail,
  type ShareTaskMutation,
  type ShareTrackerTasks,
} from "@ztask/shared";
import {
  clearSessionCookie,
  destroySession,
  exchangeShareToken,
  resolveShareSession,
  type MemberPrincipal,
} from "./share-auth.js";
import {
  isRelated,
  listTaskAggregates,
  mainAssignmentRole,
  memberVisibleAggregates,
  pruneMemberTree,
  toMemberTask,
} from "./share-scope.js";
import {
  createShareTaskWriteService,
  type ShareDetailInput,
  type ShareProgressInput,
  type ShareSubtaskCreateInput,
  type ShareSubtaskUpdateInput,
} from "./share-task-writes.js";
import { createMemberService, type MemberFile } from "../members/member-service.js";
import { createFolderService } from "../folders/folder-service.js";
import { readTaskAggregate } from "../../storage/task-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";

/** 分享域根路径（05 §6）；插件内全部路由都在此作用域下。 */
const SHARE_BASE_PATH = "/api/v1/share";

/** 会话三端点（POST/GET/DELETE）不要求既有会话，preHandler 跳过（05 §6.1–6.3）。 */
const SHARE_SESSION_PATH = `${SHARE_BASE_PATH}/session`;

/** tracker 单页条数（05 §6.4）。 */
const TRACKER_PAGE_LIMIT = 50;

/** 令牌交换限流：固定窗口 60s / 每 IP 10 次（05 §6.1）；GET/DELETE 不计数。 */
const EXCHANGE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const EXCHANGE_RATE_LIMIT_MAX = 10;

/** 限流 windows Map 的清扫阈值：达到后先清掉全部过期窗口，避免长期只增不减（§6.5）。 */
const EXCHANGE_RATE_LIMIT_SWEEP_THRESHOLD = 256;

const IMPORTANCES: readonly Importance[] = ["high", "mid", "low"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module "fastify" {
  export interface FastifyRequest {
    /** preHandler 解析一次的成员 principal；仅 session 三端点为 null（05 §6）。 */
    sharePrincipal: MemberPrincipal | null;
  }
}

/** 单个 IP 的固定窗口计数；窗口过期后计数归零。 */
interface ExchangeWindow {
  count: number;
  resetAt: number;
}

/**
 * 令牌交换限流器（05 §6.1）：插件实例内存态，按 request.ip 计固定窗口。
 *
 * Map 清理（§6.5）：命中过期窗口时就地删除；条目数达到阈值时清扫全部过期项。
 * 阈值只是防长期增长的上限，不改变「60s / 10 次 + 429」的判定行为。
 * @param now 可注入时钟（毫秒）；缺省系统时间。
 * @returns hit() 记录一次尝试，超限返回 Retry-After 秒数。
 */
function createExchangeRateLimiter(now: () => number) {
  const windows = new Map<string, ExchangeWindow>();

  /** 删除所有已过期窗口；只在达到阈值时调用，均摊成本可忽略。 */
  function sweepExpired(current: number): void {
    for (const [ip, window] of windows) {
      if (window.resetAt <= current) windows.delete(ip);
    }
  }

  return {
    hit(ip: string): { retryAfterSeconds: number } | null {
      const current = now();
      if (windows.size >= EXCHANGE_RATE_LIMIT_SWEEP_THRESHOLD) sweepExpired(current);
      let window = windows.get(ip);
      if (window !== undefined && window.resetAt <= current) {
        // 过期即删（而不是原地复用）：唯一 IP 越多时 Map 不会只增不减。
        windows.delete(ip);
        window = undefined;
      }
      window ??= { count: 0, resetAt: current + EXCHANGE_RATE_LIMIT_WINDOW_MS };
      window.count += 1;
      windows.set(ip, window);
      if (window.count <= EXCHANGE_RATE_LIMIT_MAX) return null;
      return { retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - current) / 1000)) };
    },
  };
}

/** 稳定排序：createdAt 升序，相同时按 taskId 升序（07 §5.1 / 05 §6.4）。 */
function compareAggregates(a: TaskAggregate, b: TaskAggregate): number {
  if (a.task.createdAt !== b.task.createdAt) return a.task.createdAt < b.task.createdAt ? -1 : 1;
  if (a.taskId === b.taskId) return 0;
  return a.taskId < b.taskId ? -1 : 1;
}

/** 游标位置：最后一项的 (createdAt, taskId)（05 §1 / 07 §5.1）。 */
interface CursorPosition {
  createdAt: string;
  taskId: string;
}

/**
 * 编码位置游标：base64url(JSON)，对前端保持 opaque（05 §1；前端只透传字符串）。
 * @param position 本页最后一项的排序位置。
 * @returns 不透明游标字符串。
 */
function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify({ createdAt: position.createdAt, taskId: position.taskId }), "utf8").toString("base64url");
}

/**
 * 解码位置游标（05 §6.4）：必须是 base64url 的 JSON 对象，含可解析的
 * createdAt 与 UUID 形态的 taskId；其余一律 400，不向客户端暴露内部结构。
 *
 * 与旧实现的区别：游标只描述「位置」，不要求在结果集中存在
 * （07 §5.1「以最后一项的 createdAt/id 生成 opaque cursor」），
 * 因此游标项被管理员删除/改字段后仍能续页。
 * @param cursor 查询参数原值。
 * @returns 校验后的位置。
 */
function decodeCursor(cursor: string): CursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_REQUEST", "cursor 非法");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ApiError(400, "INVALID_REQUEST", "cursor 非法");
  }
  const { createdAt, taskId } = parsed as { createdAt?: unknown; taskId?: unknown };
  if (typeof createdAt !== "string" || typeof taskId !== "string") {
    throw new ApiError(400, "INVALID_REQUEST", "cursor 非法");
  }
  if (!UUID_PATTERN.test(taskId) || !Number.isFinite(Date.parse(createdAt))) {
    throw new ApiError(400, "INVALID_REQUEST", "cursor 非法");
  }
  return { createdAt, taskId };
}

/** 聚合是否严格排在游标位置之后（createdAt, taskId 升序）。 */
function isAfterCursor(aggregate: TaskAggregate, cursor: CursorPosition): boolean {
  if (aggregate.task.createdAt !== cursor.createdAt) return aggregate.task.createdAt > cursor.createdAt;
  return aggregate.taskId > cursor.taskId;
}

/**
 * 成员分享域路由（05 §6.1–6.11）：会话交换/恢复/注销、相关任务视图/详情、
 * 只读任务夹树，以及 #19 的成员写端点（进度/详情/小任务，§6.6–6.10）。
 * @param app Fastify 实例。
 * @param options 装配项（dataDir）。
 */
export async function shareRoutes(
  app: FastifyInstance,
  options: { dataDir: string },
): Promise<void> {
  const { store: memberStore } = createMemberService({ dataDir: options.dataDir });
  // 写路径复用同一 dataDir 与提交协议（06 §8.2）；成员身份由 preHandler 解析的 principal 提供。
  const { service: shareTaskWrites } = createShareTaskWriteService({ dataDir: options.dataDir });
  const exchangeLimiter = createExchangeRateLimiter(() => Date.now());

  app.decorateRequest("sharePrincipal", null);

  async function memberMap(): Promise<Map<string, MemberFile>> {
    const map = new Map<string, MemberFile>();
    for (const entry of await memberStore.list()) map.set(entry.id, entry.value);
    return map;
  }

  /** preHandler 已保证非 session 端点有 principal；此处做类型收窄的兜底。 */
  function requirePrincipal(request: FastifyRequest): MemberPrincipal {
    const principal = request.sharePrincipal;
    if (!principal) throw new ApiError(401, "SHARE_SESSION_REQUIRED", "需要成员会话");
    return principal;
  }

  /**
   * 定位任务聚合（05 §6.5）：主任务直读；小任务在成员可见聚合内查找。
   * 非法 UUID / 不存在 / 软删除 / 存储读取异常统一 null，由调用方映射 404，不泄露细节。
   * @param id 主任务或小任务 UUID。
   * @returns 聚合与是否主任务；不可见为 null。
   */
  async function resolveAggregate(id: string): Promise<{ aggregate: TaskAggregate; isMain: boolean } | null> {
    if (!UUID_PATTERN.test(id)) return null;
    let direct: TaskAggregate | null;
    try {
      direct = await readTaskAggregate(options.dataDir, id);
    } catch {
      return null;
    }
    if (direct) return direct.task.deletedAt === null ? { aggregate: direct, isMain: true } : null;
    for (const aggregate of await listTaskAggregates(options.dataDir)) {
      if (aggregate.task.deletedAt !== null) continue;
      if (aggregate.subtasks.some((sub) => sub.id === id && sub.deletedAt === null)) {
        return { aggregate, isMain: false };
      }
    }
    return null;
  }

  /** 解析 view；只接受 home/tracker（05 §6.4），其余 400。 */
  function parseView(value: string | undefined): "home" | "tracker" {
    const view = value ?? "home";
    if (view !== "home" && view !== "tracker") throw new ApiError(400, "INVALID_REQUEST", "view 须为 home 或 tracker");
    return view;
  }

  /** 解析 importance；all/缺省表示不过滤，非 high/mid/low 400。 */
  function parseImportance(value: string | undefined): Importance | null {
    if (value === undefined || value === "all") return null;
    if (IMPORTANCES.includes(value as Importance)) return value as Importance;
    throw new ApiError(400, "INVALID_REQUEST", "importance 非法");
  }

  /** folderId + 全部后代任务夹集合；folderId 无效时只含自身（结果为空集）。 */
  async function folderScope(folderId: string): Promise<Set<string>> {
    const folders = await createFolderService({ dataDir: options.dataDir }).service.list();
    const scope = new Set<string>([folderId]);
    let frontier = [folderId];
    while (frontier.length > 0) {
      const next = folders.filter((folder) => folder.parentId !== null && frontier.includes(folder.parentId)).map((folder) => folder.id);
      for (const id of next) scope.add(id);
      frontier = next;
    }
    return scope;
  }

  // 会话与私密数据不得进入任何缓存（05 §6/§7）；onRequest 最早执行，
  // 连请求体解析失败等前置错误也带 no-store。
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "no-store");
  });

  app.addHook("preHandler", async (request) => {
    const path = (request.raw.url ?? "/").split("?")[0]!.replace(/\/+$/, "");
    if (path === SHARE_SESSION_PATH) return;
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (!principal) throw new ApiError(401, "SHARE_SESSION_REQUIRED", "需要成员会话");
    request.sharePrincipal = principal;
  });

  app.post(
    SHARE_SESSION_PATH,
    async (request, reply) => {
      const limit = exchangeLimiter.hit(request.ip);
      if (limit) {
        reply.header("retry-after", String(limit.retryAfterSeconds));
        throw new ApiError(429, "SHARE_EXCHANGE_RATE_LIMITED", "分享链接交换过于频繁，请稍后再试");
      }
      const body = request.body as { token?: unknown } | null;
      const token = typeof body?.token === "string" ? body.token : "";
      const session = await exchangeShareToken({ dataDir: options.dataDir, token });
      if (!session) throw new ApiError(401, "SHARE_LINK_INVALID", "分享链接无效");
      return await reply
        .status(201)
        .header("set-cookie", session.cookie)
        .send({ member: session.member } satisfies ShareSessionResponse);
    },
  );

  app.get(SHARE_SESSION_PATH, async (request) => {
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (!principal) throw new ApiError(401, "SHARE_SESSION_REQUIRED", "需要成员会话");
    return { member: principal.member } satisfies ShareSessionResponse;
  });

  app.delete(SHARE_SESSION_PATH, async (request, reply) => {
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (principal) await destroySession(options.dataDir, principal.sessionId);
    return await reply.status(204).header("set-cookie", clearSessionCookie()).send();
  });

  app.get(`${SHARE_BASE_PATH}/tasks`, async (request) => {
    const principal = requirePrincipal(request);
    const query = request.query as { view?: string; folderId?: string; q?: string; importance?: string; cursor?: string };
    const view = parseView(query.view);
    const importance = parseImportance(query.importance);
    const members = await memberMap();
    const aggregates = memberVisibleAggregates(await listTaskAggregates(options.dataDir), principal.memberId);

    if (view === "home") {
      // 05 §6.4 + 07 §5.1：owned = 主任务 owner；collaborated = 主任务 collaborator。
      // 分组只看主任务分配（mainAssignmentRole），仅小任务被分配者两组都不出现
      // ——「subtask-only 只出现在只读事项跟踪」。
      const owned: TaskAggregate[] = [];
      const collaborated: TaskAggregate[] = [];
      for (const aggregate of aggregates) {
        const role = mainAssignmentRole(aggregate, principal.memberId);
        if (role === "owner") owned.push(aggregate);
        else if (role === "collaborator") collaborated.push(aggregate);
      }
      return {
        // 05 §1 的稳定顺序同样适用于个人页：createdAt, id 升序，避免 readdir 序造成卡片跳动。
        owned: owned
          .sort(compareAggregates)
          .map((aggregate) => toMemberTask(aggregate, principal.memberId, members)),
        collaborated: collaborated
          .sort(compareAggregates)
          .map((aggregate) => toMemberTask(aggregate, principal.memberId, members)),
      } satisfies ShareHomeTasks;
    }

    let items = aggregates;
    if (query.folderId) {
      const scope = await folderScope(query.folderId);
      items = items.filter((aggregate) => scope.has(aggregate.task.folderId));
    }
    if (importance) items = items.filter((aggregate) => aggregate.task.importance === importance);
    if (query.q) items = items.filter((aggregate) => aggregate.task.description.includes(query.q!));

    const sorted = [...items].sort(compareAggregates);
    // 位置游标（05 §1 / 07 §5.1）：取第一个严格大于游标位置的项续页。
    // 删掉「游标 taskId 必须仍在当前结果集」的成员资格校验——游标描述位置，
    // 不描述成员资格，游标项被管理员软删除/改字段后仍应正常续页。
    let start = 0;
    if (query.cursor !== undefined) {
      const cursor = decodeCursor(query.cursor);
      const index = sorted.findIndex((aggregate) => isAfterCursor(aggregate, cursor));
      start = index < 0 ? sorted.length : index;
    }

    const page = sorted.slice(start, start + TRACKER_PAGE_LIMIT);
    const hasMore = start + page.length < sorted.length;
    const nextCursor = hasMore && page.length > 0
      ? encodeCursor({
        createdAt: page[page.length - 1]!.task.createdAt,
        taskId: page[page.length - 1]!.taskId,
      })
      : null;
    return {
      items: page.map((aggregate) => toMemberTask(aggregate, principal.memberId, members)),
      nextCursor,
    } satisfies ShareTrackerTasks;
  });

  app.get(`${SHARE_BASE_PATH}/tasks/:id`, async (request): Promise<ShareTaskDetail> => {
    const principal = requirePrincipal(request);
    const { id } = request.params as { id: string };
    const resolved = await resolveAggregate(id);
    if (!resolved) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    const relation = isRelated(resolved.aggregate, principal.memberId);
    // 不相关任务一律 404，不泄露他人资源（05 §6.5 / §8）。
    if (!relation.related) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");

    const members = await memberMap();
    if (resolved.isMain) {
      // 07 §5.1：subtask-only 读父任务上下文时 detail 由 toMemberTask 抹成空串。
      return { ...toMemberTask(resolved.aggregate, principal.memberId, members), memberRole: relation.role };
    }
    // 小任务详情（05 §6.5）：parent 是同口径成员 DTO，因此同样不含主任务 detail，
    // 且只含当前成员可见的小任务。
    const parent = toMemberTask(resolved.aggregate, principal.memberId, members);
    const subtask = parent.subtasks.find((entry) => entry.id === id);
    if (!subtask) throw new ApiError(404, "TASK_NOT_FOUND", "任务不存在");
    return { task: subtask, parent, memberRole: relation.role };
  });

  // ---- 成员写端点（05 §6.6–6.10） ----
  // schema 一律 required version + additionalProperties:false：缺失 version 由 ajv 回 400，
  // 未知字段（例如小任务的 owner）直接拒绝而不是静默剥离（05 §1）。
  // 409 冲突由服务层抛 ApiError(TASK_VERSION_CONFLICT)，app 级 errorHandler 统一序列化，
  // 因此这里不需要像管理端那样手工拼错误体。
  const versionProperty = { type: "integer", minimum: 1 } as const;

  app.patch(
    `${SHARE_BASE_PATH}/tasks/:id/progress`,
    {
      schema: {
        body: {
          type: "object",
          required: ["progress", "version"],
          properties: {
            progress: { type: "integer", minimum: 0, maximum: 100 },
            version: versionProperty,
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<ShareTaskMutation> => {
      const principal = requirePrincipal(request);
      const { id } = request.params as { id: string };
      return await shareTaskWrites.saveProgress(
        principal.memberId,
        principal.member.name,
        id,
        request.body as ShareProgressInput,
      );
    },
  );

  app.patch(
    `${SHARE_BASE_PATH}/tasks/:id/detail`,
    {
      schema: {
        body: {
          type: "object",
          required: ["detail", "version"],
          properties: { detail: { type: "string" }, version: versionProperty },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<ShareTaskMutation> => {
      const principal = requirePrincipal(request);
      const { id } = request.params as { id: string };
      return await shareTaskWrites.saveDetail(
        principal.memberId,
        principal.member.name,
        id,
        request.body as ShareDetailInput,
      );
    },
  );

  app.post(
    `${SHARE_BASE_PATH}/tasks/:id/subtasks`,
    {
      schema: {
        body: {
          type: "object",
          required: ["version", "description"],
          properties: {
            version: versionProperty,
            description: { type: "string" },
            progress: { type: "integer", minimum: 0, maximum: 100 },
            importance: { type: "string", enum: ["high", "mid", "low"] },
            dueDate: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { id } = request.params as { id: string };
      const mutation: ShareTaskMutation = await shareTaskWrites.createSubtask(
        principal.memberId,
        principal.member.name,
        id,
        request.body as ShareSubtaskCreateInput,
      );
      return await reply.status(201).send(mutation);
    },
  );

  app.patch(
    `${SHARE_BASE_PATH}/tasks/:id/subtasks/:subtaskId`,
    {
      schema: {
        body: {
          type: "object",
          required: ["version"],
          properties: {
            version: versionProperty,
            description: { type: "string" },
            progress: { type: "integer", minimum: 0, maximum: 100 },
            importance: { type: "string", enum: ["high", "mid", "low"] },
            dueDate: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<ShareTaskMutation> => {
      const principal = requirePrincipal(request);
      const { id, subtaskId } = request.params as { id: string; subtaskId: string };
      return await shareTaskWrites.updateSubtask(
        principal.memberId,
        principal.member.name,
        id,
        subtaskId,
        request.body as ShareSubtaskUpdateInput,
      );
    },
  );

  app.delete(
    `${SHARE_BASE_PATH}/tasks/:id/subtasks/:subtaskId`,
    {
      schema: {
        querystring: {
          type: "object",
          required: ["version"],
          properties: { version: versionProperty },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<ShareTaskMutation> => {
      const principal = requirePrincipal(request);
      const { id, subtaskId } = request.params as { id: string; subtaskId: string };
      const query = request.query as { version?: unknown };
      return await shareTaskWrites.deleteSubtask(
        principal.memberId,
        principal.member.name,
        id,
        subtaskId,
        query.version,
      );
    },
  );

  app.get(`${SHARE_BASE_PATH}/folders/tree`, async (request) => {
    const principal = requirePrincipal(request);
    const aggregates = memberVisibleAggregates(await listTaskAggregates(options.dataDir), principal.memberId);
    // 05 §6.11：复用管理端 folder-service.tree 产出同构 FolderTreeNode[]，再按成员范围裁剪空任务夹。
    // FolderService.tree 的返回类型已是 FolderTreeNode[]（§6.8），此处不再需要双重转换。
    const { service: folderService } = createFolderService({ dataDir: options.dataDir });
    const tree = await folderService.tree(aggregates);
    return { tree: pruneMemberTree(tree) };
  });
}
