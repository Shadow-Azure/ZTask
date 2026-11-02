import type { FastifyInstance } from "fastify";
import type { ShareLinkService } from "./share-links.js";

/** 分享链接管理端点基址（05 §4.5–4.8）；{id} 是成员 UUID。 */
const MEMBER_SHARE_LINK_PATH = "/api/v1/admin/members/:id/share-link";
const MEMBER_SHARE_LINK_ROTATE_PATH = `${MEMBER_SHARE_LINK_PATH}/rotate`;

/**
 * 管理端分享链接路由（05 §4.5–4.8）。
 *
 * - POST 201：完整 url 只在此次响应返回；已有 active 链接 409 ACTIVE_SHARE_LINK_EXISTS，
 *   LAN 未运行 409 LAN_SHARE_DISABLED；
 * - POST rotate 200：旧链接/旧会话立即失效，新 URL 使用当前 shareBaseUrl；
 * - DELETE 204：幂等吊销，不删除成员或任务；
 * - GET 200：只返回脱敏状态，永不返回旧 URL/tokenHash。
 *
 * 全部端点位于 `/api/v1/admin` 前缀，LAN listener 上由 app 级守卫统一 403（04 §4.1）。
 * @param app Fastify 实例。
 * @param options 装配项（ShareLinkService）。
 */
export async function shareLinkRoutes(app: FastifyInstance, options: { service: ShareLinkService }): Promise<void> {
  app.post(MEMBER_SHARE_LINK_PATH, async (request, reply) => {
    const { id } = request.params as { id: string };
    return await reply.status(201).send(await options.service.generate(id));
  });

  app.post(MEMBER_SHARE_LINK_ROTATE_PATH, async (request) => {
    const { id } = request.params as { id: string };
    return await options.service.rotate(id);
  });

  app.delete(MEMBER_SHARE_LINK_PATH, async (request, reply) => {
    const { id } = request.params as { id: string };
    await options.service.revoke(id);
    return await reply.status(204).send();
  });

  app.get(MEMBER_SHARE_LINK_PATH, async (request) => {
    const { id } = request.params as { id: string };
    return await options.service.get(id);
  });
}
