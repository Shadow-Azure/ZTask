import type { FastifyInstance } from "fastify";
import { readTaskAggregate } from "../../storage/task-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";
import { createFolderService, toFolderDto } from "./folder-service.js";

/**
 * 管理端任务夹路由（05 §3.1–3.3）。Admin 本机专用守卫由 app 级 preHandler 统一执行。
 * @param app Fastify 实例。
 * @param options 装配项（dataDir 用于直读聚合）。
 */
export async function folderRoutes(
  app: FastifyInstance,
  options: { dataDir: string },
): Promise<void> {
  const { service } = createFolderService({ dataDir: options.dataDir });

  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  async function loadAggregates(): Promise<TaskAggregate[]> {
    const { readdir } = await import("node:fs/promises");
    const dir = `${options.dataDir}/tasks`;
    let ids: string[] = [];
    try {
      ids = await readdir(dir);
    } catch {
      ids = [];
    }
    const aggregates: TaskAggregate[] = [];
    for (const taskId of ids.filter((name) => uuidLike.test(name))) {
      const aggregate = await readTaskAggregate(options.dataDir, taskId);
      if (aggregate) aggregates.push(aggregate);
    }
    return aggregates;
  }

  app.get(
    "/api/v1/admin/folders/tree",
    async () => ({ tree: await service.tree(await loadAggregates()) }),
  );

  app.post(
    "/api/v1/admin/folders",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" }, parentId: { type: ["string", "null"] } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { name: string; parentId: string | null };
      const folder = await service.create({ name: body.name, parentId: body.parentId ?? null });
      return await reply.status(201).send(toFolderDto(folder));
    },
  );

  app.patch(
    "/api/v1/admin/folders/:id",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name: string };
      return await reply.send(toFolderDto(await service.rename(id, body.name)));
    },
  );
}
