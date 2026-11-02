import {
  API_PREFIX,
  type AdminShareLinkIssued,
  type AdminShareLinkState,
  type NetworkState,
} from "@ztask/shared";
import { requestJson } from "./http";

/**
 * 管理端网络资源函数（05 §2.3/§4.9，08 §5）：
 * 仅本机管理员可见；PUT 必须 bind 成功后才返回 running=true，
 * 因此调用方以响应体而不是本地猜测判断是否已开启。
 */
export const networkApi = {
  /** 当前网络状态：loopback 地址、可选网卡与分享监听事实（GET /admin/network）。 */
  network: () => requestJson<NetworkState>(`${API_PREFIX}/admin/network`),

  /** 启动或切换 LAN 监听（PUT /admin/network/share-listener）：host 必须是具体网卡地址。 */
  enableShareListener: (input: { host: string; port: number }) =>
    requestJson<NetworkState>(`${API_PREFIX}/admin/network/share-listener`, {
      method: "PUT",
      body: { host: input.host, port: input.port },
    }),

  /** 停止 LAN 监听（DELETE）：只关闭局域网入口，不吊销 token、不删除会话。 */
  disableShareListener: () =>
    requestJson<void>(`${API_PREFIX}/admin/network/share-listener`, { method: "DELETE" }),
};

/**
 * 管理端分享链接生命周期端点（05 §4.5–§4.8）：
 * 完整 url 只在生成/重置当次响应出现；GET 永远只返回脱敏态。
 */
export const shareLinkApi = {
  /** 链接脱敏态；从未生成时 status=none（GET /admin/members/{id}/share-link）。 */
  shareLink: (memberId: string) =>
    requestJson<AdminShareLinkState>(`${API_PREFIX}/admin/members/${memberId}/share-link`),

  /** 为尚无 active 链接的成员生成链接（POST）：409 ACTIVE_SHARE_LINK_EXISTS / LAN_SHARE_DISABLED。 */
  generateShareLink: (memberId: string) =>
    requestJson<AdminShareLinkIssued>(`${API_PREFIX}/admin/members/${memberId}/share-link`, { method: "POST" }),

  /** 作废旧 token 并生成新 token（POST rotate）：旧链接与旧会话立即失效。 */
  rotateShareLink: (memberId: string) =>
    requestJson<AdminShareLinkIssued>(`${API_PREFIX}/admin/members/${memberId}/share-link/rotate`, {
      method: "POST",
    }),

  /** 吊销链接（DELETE，幂等 204）：成员无法再访问，可随时重新生成。 */
  revokeShareLink: (memberId: string) =>
    requestJson<void>(`${API_PREFIX}/admin/members/${memberId}/share-link`, { method: "DELETE" }),
};
