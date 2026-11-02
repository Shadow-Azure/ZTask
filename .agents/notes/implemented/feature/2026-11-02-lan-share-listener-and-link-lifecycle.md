# Agent Note: 分享监听的动态启停与链接凭证边界

Status: implemented

[English](2026-11-02-lan-share-listener-and-link-lifecycle.en.md) | 中文

## Problem

成员协作要求「同一进程、两个监听」：loopback 只给管理员，具体局域网 IP 只开放成员分享域，两者共享同一份 Store/Service/写队列，不能变成两个 ZTask 实例。[全栈设计](../../../../plan/fullstack-design/01-architecture.md) 01 §3 与 [04](../../../../plan/fullstack-design/04-backend-architecture.md) §4.1/§9 定了启停顺序与权限原则，[05](../../../../plan/fullstack-design/05-api-design.md) §4.5–4.9 定了链接与网络端点，但没有定「运行状态如何与 network.json 对齐」「未运行时分享 URL 是否可展示」「链接 secret 是否可恢复」「轮换如何让旧会话失效」这些实现边界。它们决定了分享是否会向成员分发不可达或已失效的地址，因此必须在同一处定下来。

## Decision

- **双 Fastify 实例、同一 Store/Service**：`buildApp` 按 `listenerKind` 创建 loopback 与 LAN 两个实例，共享 `ZtaskStore` 与网络/链接 Service；Admin 本机守卫（listenerKind=loopback 且对端 loopback）在 LAN 实例上把 `/api/v1/admin/*` 一律拒绝。不用单实例多监听，因为 listenerKind 是实例级装饰。
- **配置与运行态分离**：`network.json` 只存期望配置（enabled/host/port/shareBaseUrl）；running/degraded/error 是 `NetworkService` 的运行态。只有 running 时才输出 `shareBaseUrl`，degraded/offline 必须为 null，避免分发看似可用的地址。
- **启停顺序**：开启/切换先 bind 新 LAN 入口 → 原子写配置 → 成功后关闭旧入口；写失败只关闭新入口并保留旧入口。关闭先写 `enabled=false`，写失败保持运行、不吊销 token。重启先保证 loopback，再按 `network.json` 恢复 LAN；恢复失败标记 degraded，不影响管理端。
- **hash-only 链接**：`share-links/<memberId>.json` 只存 token 的 SHA-256；完整 URL 只在 `generate`/`rotate` 响应出现一次，刷新后只能重置。不要为了「可再次复制」把 raw token 写进成员或链接文件。
- **轮换/吊销/归档的失效链**：`rotate` 用新 id/tokenHash 原子替换并删除该成员全部 `auth-sessions`；`revoke` 幂等写 revoked 并删除会话；归档成员先吊销链接再写 `archivedAt`。最终失效仍由每请求的 link 状态校验兜底，删除会话只是清理。
- **URL 只由 shareBaseUrl 派生**：token 文件不固化完整 URL；切换 LAN 地址只更新 `network.json`，token 不变，已分发旧 URL 需管理员重新发送（CLI `--lan` 只负责启动时恢复）。
- **Admin 守卫按解码后的路由模板判定**：不能用 `raw.url` 前缀（它保留百分号编码，`/api/v1/%61dmin/members` 会绕过并命中 admin 路由）。守卫用 `request.routeOptions.url`（未命中时回退单次解码 pathname），并要求 Host ∈ {127.0.0.1, localhost, ::1, 绑定 host} 以防 DNS rebinding；LAN 实例仍注册 admin 路由以保留 403 语义。
- **同源写保护**：所有非 `GET/HEAD/OPTIONS` 请求在路由注册前校验 `Origin`（存在时必须与 `Host` 同源）与 `Sec-Fetch-Site`（`cross-site`/`same-site` 拒绝）；无浏览器头的 CLI/测试请求放行。LAN 暴露后，没有 body schema 的 `POST rotate` 不能再被跨站表单触发。
- **安全响应头在本 PR 补齐**：在 `Referrer-Policy`/`nosniff` 之外新增全局 CSP；脚本只允许同源，样式因 Vue `:style` 显式放开 `'unsafe-inline'`，并禁止被 iframe 套壳。

## Alternatives considered

- 单 Fastify 实例同时监听两个地址：`listenerKind` 是实例级装饰，无法按连接区分管理员/成员，否决。
- 把 `shareBaseUrl` 写进每份 share-link 文件：换 IP 需要重写所有 token 文件，且 token 与网络配置耦合，否决。
- 持久化 raw token 以便随时复制旧链接：把长期凭证写进磁盘，泄露面扩大，否决；页面刷新后只提供「重置并重新展示」。
- 轮换时保留旧 session 文件、只靠 linkId 校验：功能上可行，但旧文件永久累积且审计噪声大；既然 rotate/revoke 是低频操作，顺手删除该成员会话更干净。
- 关闭分享时把链接标成 revoked：会让「恢复分享后旧链接仍可用」失效，违反 01 §3.1/§3.2，否决。

## Consequences

- `ServeHandle` 暴露 network/shareLink service 供路由、CLI 与测试使用；LAN 恢复失败是**降级**而非启动失败，健康检查仍可用。
- 分享 URL 的复制只在生成/重置后的受控结果区出现；管理员刷新页面后必须重置才能拿到新 URL，这是 hash-only 的必然代价。
- 会话文件清理现在覆盖 rotate/revoke/归档三条路径；过期会话的定时清理仍留作后续欠账（#18 的 Note 已记录）。
- 运行中地址从网卡消失时，`state()`/`isRunning()`/`shareBaseUrl()` 会按 degraded 呈现并停止分发地址；旧 listener 句柄关闭失败时只能随进程退出释放（已知边界，无实害）。
- 静态壳、API 与错误响应统一带 CSP 和同源写保护；新增 mutation 端点无需额外配置，但非浏览器客户端若带不匹配的 `Origin` 会被拒绝。
- 多进程/反向代理不在首版范围；限流与 NAT 共享出口 IP 的阈值需在启用 LAN 前重评（#18 Note 已记录）。
