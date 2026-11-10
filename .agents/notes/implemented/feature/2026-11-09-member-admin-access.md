# Agent Note: 成员管理员权限与 LAN 管理页访问

Status: implemented

[English](2026-11-09-member-admin-access.en.md) | 中文

## Problem

ZTask 原先只有“本机管理员 / 局域网成员”两种身份（[01](../../../../plan/fullstack-design/01-architecture.md) §4、[04](../../../../plan/fullstack-design/04-backend-architecture.md) §4.1、[05](../../../../plan/fullstack-design/05-api-design.md) §1）：Admin API 同时要求 loopback listener、本机远端地址与可信 Host，LAN listener 上的 `/api/v1/admin/*` 一律 403；成员分享链接只进入成员个人页与只读事项跟踪。用户要求“给某个成员管理员权限，成员有了权限以后链接进入管理员页面”，这意味着分享链接的身份可以携带管理能力，必须明确新的授权边界、会话 Cookie 范围与 LAN 上的 Admin 暴露面。

## Decision

- **成员记录增加管理员标记**：`members.is_admin` 布尔列由 v2 migration 追加，默认 false；旧库升级与旧文件导入都保持普通成员。成员创建/更新 DTO 接受 `isAdmin`，成员管理浮窗提供“管理员权限”勾选，列表显示徽标。
- **分享链接按权限落地**：`/share/session` 响应增加 `isAdmin`。令牌交换成功后，管理员成员 replace 到 `/#/tracker`，普通成员保持 `/#/s/home`；token 仍从地址栏清除。
- **LAN Admin API 对管理员成员开放**：Admin 守卫在原有 loopback + 本机对端 + 可信 Host 规则之外，允许 LAN listener 上持有有效成员会话且当前 `isAdmin=true` 的请求。会话不缓存管理员标记，每次请求重新读取成员行；成员被撤权、归档或链接被重置/吊销后，残留会话立即失去 Admin 权限。
- **会话 Cookie 覆盖整个源**：`ztask_share_session` 的 Path 从 `/api/v1/share` 放宽到 `/`，使管理员成员能用同一 HttpOnly + SameSite=Strict 会话调用 `/api/v1/admin/*`；非管理员会话即使携带 Cookie 也会被 Admin 守卫拒绝。交换、恢复与注销都会显式清除旧 Path 副本；恢复会话还会把旧 Path 会话刷新为 Path=/，避免升级前的 Cookie 抢先占用新链接的请求。
- **管理壳先验证入口**：从回环主机打开管理页时沿用无会话本机管理员；从 LAN 打开时先 `GET /share/session`，仅管理员成员渲染管理导航；普通成员、无会话与恢复失败分别显示明确页面，且不提前请求 Admin API。
- **能力范围**：管理员成员获得完整 Admin API（任务、成员、看板、历史、备份、网络与分享链接管理），与身份位一致；不新增单独的“只读管理员”或“任务管理员”档位。

## Alternatives considered

- 在分享域复制一套管理端 API：会与 Admin API 双写、双份权限校验和双份测试，长期漂移，否决。
- 只在前端把管理员链接跳到管理页、不放宽服务端：页面能打开但所有 Admin 请求 403，用户拿到的是空壳，否决。
- 保留 loopback-only，要求成员登录服务主机操作：不满足“链接进入管理员页面”，否决。
- 为管理员单独生成另一种链接/账号：引入第二套凭证生命周期，且成员升降级要重新发链接，成本高于在成员记录上放一个布尔位，否决。
- 把管理员 token 放进 URL 查询参数：会进入日志/Referer/历史，直接违反现有分享 token 只在 fragment 的约束，否决。

## Consequences

- 威胁模型从“LAN 只有成员域”变成“LAN 可能出现完整的 Admin API”。管理员成员设备上的会话 Cookie 一旦泄露，等价于管理员权限；撤销权限、归档成员或重置/吊销链接是止损手段，且逐请求生效。
- 管理员成员在管理端的任务改动仍以 `actor.kind=admin`、`actor.name=管理员` 写入 revision，暂时无法区分具体是哪位管理员成员；若后续需要审计身份，需把 Admin principal 传入 revision 写入路径。
- 管理页与成员页共用同一 SPA 和同一会话 Cookie；管理员成员仍可手动访问 `/s/home`，但链接落地固定进入管理页。此行为避免为成员视图再造一套壳。
- 现有 SQLite 库自动迁移到 schema v2；备份、恢复与 `doctor` 继续按 schema 版本校验。旧文件导入的成员一律普通成员，需管理员显式授予权限。
- 新增前端入口门控只影响体验，服务端 Admin 守卫始终是唯一授权边界；测试覆盖无会话、普通成员、管理员成员、撤权与管理员链接落地。
