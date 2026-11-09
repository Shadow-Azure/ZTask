/**
 * Web 侧的主机分类（仅用于体验门控，不承担安全职责）。
 *
 * 管理端在服务主机本机打开时没有成员会话；从局域网打开时必须有管理员成员会话。
 * 服务端始终自行校验 Admin 访问，这里只决定管理壳先恢复会话还是直接渲染。
 */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * 判断当前页面是否从回环主机打开。
 * @param hostname `window.location.hostname`（大小写与 IPv6 方括号均可）。
 * @returns 回环主机为 true。
 */
export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.trim().toLowerCase());
}
