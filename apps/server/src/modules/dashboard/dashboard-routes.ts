import type { FastifyInstance } from "fastify";
import type { DashboardService } from "./dashboard-service.js";
import type { HistoryService } from "../revisions/history-service.js";
import { parseBucket, parseChangesParams, parseFolderId, parseMemberIds } from "./dashboard-query.js";

const ADMIN_DASHBOARD_PATH = "/api/v1/admin/dashboard";

/**
 * 管理端看板路由（05 §5.1–5.3）：summary、due-distribution 与 changes。
 * Admin 本机专用守卫由 app 级 preHandler 统一执行；成员过滤走服务层口径（#21/#22）。
 * @param app Fastify 实例。
 * @param options 共享的看板与历史服务实例。
 */
export async function dashboardRoutes(
  app: FastifyInstance,
  options: { service: DashboardService; historyService: HistoryService },
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

  // 05 §5.3：时间段历史；区间解析与成员裁剪都在历史服务内完成，路由只做 query 校验。
  app.get(`${ADMIN_DASHBOARD_PATH}/changes`, async (request) => {
    const query = request.query as Record<string, unknown>;
    return await options.historyService.changes({
      folderId: parseFolderId(query),
      memberIds: parseMemberIds(query),
      ...parseChangesParams(query),
    });
  });
}
