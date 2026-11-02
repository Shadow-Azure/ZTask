import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { clearSessionCookie, destroySession, exchangeShareToken, resolveShareSession } from "./share-auth.js";
import { buildMemberTree, isRelated, toMemberTask } from "./share-scope.js";
import { createMemberService, type MemberFile } from "../members/member-service.js";
import { readTaskAggregate } from "../../storage/task-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";

/**
 * 成员分享域路由（05 §6.1–6.5、§6.11）：会话交换/恢复/注销、
 * 相关任务视图/详情与只读任务夹树。写端点（progress/detail/subtasks）属 #19。
 * @param app Fastify 实例。
 * @param options 装配项（dataDir）。
 */
export async function shareRoutes(
  app: FastifyInstance,
  options: { dataDir: string },
): Promise<void> {
  const { service: memberService, store: memberStore } = createMemberService({ dataDir: options.dataDir });

  async function memberMap(): Promise<Map<string, MemberFile>> {
    const map = new Map<string, MemberFile>();
    for (const entry of await memberStore.list()) map.set(entry.id, entry.value);
    return map;
  }

  async function allAggregates(): Promise<TaskAggregate[]> {
    const { readdir } = await import("node:fs/promises");
    const dir = `${options.dataDir}/tasks`;
    let ids: string[] = [];
    try {
      ids = await readdir(dir);
    } catch {
      ids = [];
    }
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const aggregates: TaskAggregate[] = [];
    for (const taskId of ids.filter((name) => uuidLike.test(name))) {
      const aggregate = await readTaskAggregate(options.dataDir, taskId);
      if (aggregate) aggregates.push(aggregate);
    }
    return aggregates;
  }

  function unauthorized(reply: FastifyReply, request: { id: string }, code: "SHARE_SESSION_REQUIRED" | "SHARE_LINK_INVALID"): unknown {
    return reply.status(401).send({
      error: { code, message: code === "SHARE_LINK_INVALID" ? "分享链接无效" : "需要成员会话", requestId: request.id },
    });
  }

  app.post(
    "/api/v1/share/session",
    async (request, reply) => {
      const body = request.body as { token?: unknown } | null;
      const token = typeof body?.token === "string" ? body.token : "";
      const session = await exchangeShareToken({ dataDir: options.dataDir, token });
      if (!session) {
        return unauthorized(reply, request, "SHARE_LINK_INVALID");
      }
      return await reply
        .status(201)
        .header("set-cookie", session.cookie)
        .send({ member: session.member });
    },
  );

  app.get("/api/v1/share/session", async (request, reply) => {
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (!principal) return unauthorized(reply, request, "SHARE_SESSION_REQUIRED");
    return { member: principal.member };
  });

  app.delete("/api/v1/share/session", async (request, reply) => {
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (principal) await destroySession(options.dataDir, principal.sessionId);
    return await reply.status(204).header("set-cookie", clearSessionCookie()).send();
  });

  // —— 以下端点要求成员会话 ——

  app.addHook("preHandler", async (request, reply) => {
    const url = request.raw.url ?? "/";
    if (!url.startsWith("/api/v1/share/") || url.startsWith("/api/v1/share/session")) return;
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (!principal) {
      await reply.status(401).send({
        error: { code: "SHARE_SESSION_REQUIRED", message: "需要成员会话", requestId: request.id },
      });
    }
  });

  app.get("/api/v1/share/tasks", async (request) => {
    const query = request.query as { view?: string; folderId?: string; q?: string; importance?: string; cursor?: string };
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (!principal) {
      const error = new Error("需要成员会话");
      (error as { statusCode?: number }).statusCode = 401;
      throw error;
    }
    const memberId = principal.memberId;
    const aggregates = (await allAggregates()).filter((aggregate) => {
      if (aggregate.task.deletedAt !== null) return false;
      return isRelated(aggregate, memberId).related;
    });
    const members = await memberMap();

    if (query.view === "tracker") {
      let items: TaskAggregate[] = aggregates;
      void 0;
      if (query.folderId) {
        const folderId = query.folderId;
        const { createFolderService } = await import("../folders/folder-service.js");
        const folders = await createFolderService({ dataDir: options.dataDir }).service.list();
        const scope = new Set<string>([folderId]);
        let frontier = [folderId];
        while (frontier.length > 0) {
          const next = folders.filter((f) => f.parentId !== null && frontier.includes(f.parentId)).map((f) => f.id);
          for (const id of next) scope.add(id);
          frontier = next;
        }
        items = items.filter((aggregate) => scope.has(aggregate.task.folderId));
      }
      if (query.importance) items = items.filter((aggregate) => aggregate.task.importance === query.importance);
      if (query.q) items = items.filter((aggregate) => aggregate.task.description.includes(query.q!));
      const sorted: TaskAggregate[] = [...items].sort((a, b) => (a.task.createdAt < b.task.createdAt ? -1 : 1));
      const pageLimit = 50;
      let nextCursor: string | null = null;
      let page = sorted;
      if (sorted.length > pageLimit) {
        page = sorted.slice(0, pageLimit);
        nextCursor = Buffer.from(page[page.length - 1]!.taskId).toString("base64url");
      }
      return { items: page.map((aggregate) => toMemberTask(aggregate, memberId, members)), nextCursor };
    }

    const owned = aggregates.filter((aggregate) => mainOwnerOf(aggregate, memberId));
    const collaborated = aggregates.filter((aggregate) => {
      if (aggregate.task.deletedAt !== null) return false;
      return isRelated(aggregate, memberId).role === "collaborator";
    });
    return {
      owned: owned.map((aggregate) => toMemberTask(aggregate, memberId, members)),
      collaborated: collaborated.map((aggregate) => toMemberTask(aggregate, memberId, members)),
    };

    function mainOwnerOf(aggregate: TaskAggregate, id: string): boolean {
      return aggregate.assignments.some((a) => a.taskId === aggregate.taskId && a.memberId === id && a.kind === "owner");
    }
  });

  app.get("/api/v1/share/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (!principal) {
      const error = new Error("需要成员会话");
      (error as { statusCode?: number }).statusCode = 401;
      throw error;
    }
    const resolved = await resolveAggregate(options.dataDir, id);
    if (!resolved || resolved.aggregate.task.deletedAt !== null) {
      return await reply.status(404).send({
        error: { code: "TASK_NOT_FOUND", message: "任务不存在", requestId: request.id },
      });
    }
    const relation = isRelated(resolved.aggregate, principal.memberId);
    if (!relation.related) {
      // 不相关任务一律 404，不泄露他人资源（05 §6.5）。
      return await reply.status(404).send({
        error: { code: "TASK_NOT_FOUND", message: "任务不存在", requestId: request.id },
      });
    }
    const members = await memberMap();
    if (resolved.isMain) {
      const task = toMemberTask(resolved.aggregate, principal.memberId, members);
      return { ...task, memberRole: relation.role };
    }
    const parent = toMemberTask(resolved.aggregate, principal.memberId, members);
    const subtask = parent.subtasks.find((s) => s.id === id);
    if (!subtask) {
      return await reply.status(404).send({
        error: { code: "TASK_NOT_FOUND", message: "任务不存在", requestId: request.id },
      });
    }
    return { task: subtask, parent, memberRole: "collaborator" };
  });

  app.get("/api/v1/share/folders/tree", async (request) => {
    const principal = await resolveShareSession({ dataDir: options.dataDir, cookieHeader: request.headers.cookie });
    if (!principal) {
      const error = new Error("需要成员会话");
      (error as { statusCode?: number }).statusCode = 401;
      throw error;
    }
    const { createFolderService } = await import("../folders/folder-service.js");
    const folders = await createFolderService({ dataDir: options.dataDir }).service.list();
    return { tree: buildMemberTree(folders, await allAggregates(), principal.memberId) };
  });
}

async function resolveAggregate(dataDir: string, id: string): Promise<{ aggregate: TaskAggregate; isMain: boolean } | null> {
  const direct = await readTaskAggregate(dataDir, id);
  if (direct) return { aggregate: direct, isMain: true };
  const { readdir } = await import("node:fs/promises");
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  let ids: string[] = [];
  try {
    ids = await readdir(`${dataDir}/tasks`);
  } catch {
    return null;
  }
  for (const taskId of ids.filter((name) => uuidLike.test(name))) {
    const aggregate = await readTaskAggregate(dataDir, taskId);
    if (aggregate?.subtasks.some((sub) => sub.id === id && sub.deletedAt === null)) {
      return { aggregate, isMain: false };
    }
  }
  return null;
}
