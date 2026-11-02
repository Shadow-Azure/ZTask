import type { FastifyInstance } from "fastify";
import type { NetworkState } from "@ztask/shared";
import type { NetworkService } from "./network-service.js";

/** 网络状态端点（05 §4.9）；Admin 本机守卫由 app.ts 的 preHandler 统一执行。 */
const NETWORK_PATH = "/api/v1/admin/network";
const SHARE_LISTENER_PATH = `${NETWORK_PATH}/share-listener`;

/**
 * 管理端网络路由（05 §4.9）：
 * - GET 返回 loopback 地址、可选网卡与分享监听事实；
 * - PUT 动态启动/切换具体 LAN IP 监听，必须 bind 成功且已持久化才返回 running；
 * - DELETE 只停 LAN 入口，不吊销 token/session。
 *
 * 三个端点天然处于 `/api/v1/admin` 前缀，因此 LAN listener 上会被统一拒绝（04 §4.1）。
 * @param app Fastify 实例。
 * @param options 装配项（NetworkService）。
 */
export async function networkRoutes(app: FastifyInstance, options: { service: NetworkService }): Promise<void> {
  app.get(NETWORK_PATH, async (): Promise<NetworkState> => options.service.state());

  app.put(
    SHARE_LISTENER_PATH,
    {
      schema: {
        body: {
          type: "object",
          required: ["host", "port"],
          properties: {
            host: { type: "string" },
            port: { type: "integer" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request): Promise<NetworkState> => {
      const body = request.body as { host: string; port: number };
      // 端口范围与「必须属于本机具体地址」由 service 校验；schema 只负责字段形态，
      // 这样越界端口仍得到 422 LAN_INTERFACE_INVALID 而不是被 400 提前吞掉（05 §7）。
      return await options.service.enable(body.host, body.port);
    },
  );

  app.delete(SHARE_LISTENER_PATH, async (_request, reply) => {
    await options.service.disable();
    return await reply.status(204).send();
  });
}
