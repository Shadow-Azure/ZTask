import type { FastifyInstance, FastifyReply } from "fastify";
import { randomUUID } from "node:crypto";
import { VersionConflictError } from "../../storage/errors.js";
import type { TaskStore } from "../../storage/task-store.js";
import { createTaskService } from "./task-service.js";

/** 409 冲突的内部标记（携带最新可见任务，05 §7 details.current）。 */
interface Conflict409 {
  isConflict409: true;
  latest: unknown;
  message: string;
}

function isConflict409(cause: unknown): cause is Conflict409 {
  return (cause as { isConflict409?: boolean } | null)?.isConflict409 === true;
}

/**
 * 解析任务列表的 ownerIds：支持逗号分隔与重复参数，空值表示不筛选。
 * 具体 UUID 校验与归档成员判定留给 TaskService，保证筛选语义集中在一处。
 * @param value query 中的 ownerIds 原始值。
 * @returns 去空白后的成员 ID 列表；无有效值时 undefined。
 */
function parseOwnerIds(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const ids = (Array.isArray(value) ? value : [value])
    .flatMap((item) => item.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

/**
 * 管理端任务路由（05 §3.4–3.9）。Admin 本机专用守卫由 app 级 preHandler 统一执行；
 * VersionConflictError 统一映射 409 + 最新可见任务（details.current）。
 * @param app Fastify 实例。
 * @param options 装配项（dataDir）。
 */
export async function taskRoutes(
  app: FastifyInstance,
  options: { dataDir: string; taskStore?: TaskStore },
): Promise<void> {
  const { service } = createTaskService({ dataDir: options.dataDir, taskStore: options.taskStore });

  /** 把 VersionConflictError 转成带标记的 409 载荷。 */
  async function withConflict409(taskId: string, operation: () => Promise<unknown>): Promise<unknown> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof VersionConflictError) {
        const latest = await service.get(taskId).catch(() => null);
        throw { isConflict409: true, latest, message: "任务已被其他人更新" } satisfies Conflict409;
      }
      throw cause;
    }
  }

  async function sendConflict(reply: FastifyReply, cause: unknown): Promise<unknown> {
    if (!isConflict409(cause)) throw cause;
    return await reply.status(409).send({
      error: {
        code: "TASK_VERSION_CONFLICT",
        message: cause.message,
        requestId: randomUUID(),
        details: { current: cause.latest },
      },
    });
  }

  app.get(
    "/api/v1/admin/tasks",
    async (request) => {
      const query = request.query as {
        folderId?: string;
        includeDescendants?: string;
        q?: string;
        importance?: string;
        ownerIds?: string | string[];
        cursor?: string;
      };
      if (!query.folderId) {
        const error = new Error("folderId 必填");
        (error as { statusCode?: number }).statusCode = 400;
        throw error;
      }
      return await service.list({
        folderId: query.folderId,
        includeDescendants: query.includeDescendants !== "false",
        q: query.q,
        importance: query.importance,
        ownerIds: parseOwnerIds(query.ownerIds),
        cursor: query.cursor,
      });
    },
  );

  app.post(
    "/api/v1/admin/tasks",
    async (request, reply) => {
      const created = await service.create(request.body as Record<string, unknown>);
      return await reply.status(201).send(created);
    },
  );

  app.get("/api/v1/admin/tasks/:id", async (request) => {
    const { id } = request.params as { id: string };
    return await service.get(id);
  });

  app.patch("/api/v1/admin/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await withConflict409(id, () => service.patch(id, request.body as Record<string, unknown>));
    } catch (cause) {
      return await sendConflict(reply, cause);
    }
  });

  app.put("/api/v1/admin/tasks/:id/editor", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      return await withConflict409(id, () => service.saveEditor(id, request.body as Record<string, unknown>));
    } catch (cause) {
      return await sendConflict(reply, cause);
    }
  });

  app.delete("/api/v1/admin/tasks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as { version?: string };
    const version = Number(query.version);
    if (!Number.isInteger(version)) {
      const error = new Error("version 查询参数必填");
      (error as { statusCode?: number }).statusCode = 400;
      throw error;
    }
    try {
      await withConflict409(id, () => service.remove(id, version));
    } catch (cause) {
      return await sendConflict(reply, cause);
    }
    return await reply.status(204).send();
  });
}
