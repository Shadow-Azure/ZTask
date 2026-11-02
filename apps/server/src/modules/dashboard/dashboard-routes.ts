import type { FastifyInstance } from "fastify";
import type { DashboardService } from "./dashboard-service.js";
import { parseBucket, parseFolderId, parseMemberIds } from "./dashboard-query.js";

const ADMIN_DASHBOARD_PATH = "/api/v1/admin/dashboard";

/**
 * 管理端看板路由（05 §5.1–5.2）：summary 与 due-distribution。
 * Admin 本机专用守卫由 app 级 preHandler 统一执行；成员过滤走服务层口径（#21）。
 * @param app Fastify 实例。
 * @param options 共享的看板服务实例。
 */
export async function dashboardRoutes(
  app: FastifyInstance,
  options: { service: DashboardService },
): Promise<void> {
  app.get(`${ADMIN_DASHBOARD_PATH}/summary`, async (request) => {
    const query = request.query as Record<string, unknown>;
    return await options.service.summary({
      folderId: parseFolderId(query),
      memberIds: parseMemberIds(query),
    });
  });

  app.get(`${ADMIN_DASHBOARD_PATH}/due-distribution`, async (request) => {
    const query = request.query as Record<string, unknown>;
    return await options.service.dueDistribution({
      folderId: parseFolderId(query),
      memberIds: parseMemberIds(query),
      bucket: parseBucket(query),
    });
  });
}
