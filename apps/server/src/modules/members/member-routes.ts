import type { FastifyInstance } from "fastify";
import { readTaskAggregate } from "../../storage/task-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";
import type { ShareLinkService } from "../share/share-links.js";
import { createMemberService } from "./member-service.js";

/**
 * 管理端成员路由（05 §4.1–4.4）；分享链接端点由 share-link-routes 独立注册（§4.5–4.8）。
 * @param app Fastify 实例。
 * @param options 装配项（dataDir 用于直读聚合；shareLinkService 用于汇总与归档吊销）。
 */
export async function memberRoutes(
  app: FastifyInstance,
  options: { dataDir: string; shareLinkService?: ShareLinkService },
): Promise<void> {
  const { service } = createMemberService({ dataDir: options.dataDir, shareLinks: options.shareLinkService });

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

  app.get("/api/v1/admin/members", async () => ({
    items: await service.list(await loadAggregates()),
  }));

  app.post(
    "/api/v1/admin/members",
    {
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string" }, role: { type: "string" }, color: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { name: string; role?: string; color?: string };
      return await reply.status(201).send(await service.create(body));
    },
  );

  app.patch(
    "/api/v1/admin/members/:id",
    {
      schema: {
        body: {
          type: "object",
          properties: { name: { type: "string" }, role: { type: "string" }, color: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { name?: string; role?: string; color?: string };
      const aggregates = await loadAggregates();
      const updated = await service.update(id, body);
      // update 不重算计数；重新以新鲜聚合返回完整 DTO
      const items = await service.list(aggregates);
      return await reply.send(items.find((member) => member.id === updated.id) ?? updated);
    },
  );

  app.delete("/api/v1/admin/members/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    await service.archive(id);
    return await reply.status(204).send();
  });
}
