# 成员管理员权限与管理页访问

[English](m17-member-admin-permission.en.md) | 中文

```yaml flow
kind: issue
milestone: m17
priority: P2
status: done
scope:
  - apps/server/src/app.ts
  - apps/server/src/bootstrap.ts
  - apps/server/src/modules/members/**
  - apps/server/src/modules/share/**
  - apps/server/src/storage/**
  - apps/web/src/**
  - packages/shared/**
  - tests/**
  - docs/architecture*
  - plan/fullstack-design/**
  - .agents/notes/implemented/feature/2026-11-09-member-admin-access*
  - .agents/notes/implemented/process/2026-11-01-engineering-flow-tree*
  - .agents/flow/**
  - scripts/doc-budgets.manifest.json
  - scripts/verify-flow-online.mjs
  - scripts/verify-flow-online.spec.mjs
adr:
  - ../../notes/implemented/feature/2026-11-09-member-admin-access.md
github:
  number: 105
  url: https://github.com/Shadow-Azure/ZTask/issues/105
```

## 背景

当前权限模型只有“本机管理员”和“局域网成员”两档：Admin API 同时要求 loopback listener、本机远端地址与可信 Host，成员分享链接只进入个人页与只读事项跟踪。用户需要把某个成员设为管理员，并让该成员通过自己的分享链接进入管理员页面；这要求成员记录携带管理员能力位，并明确 LAN 上 Admin API 的授权边界。

## 目标

- 成员记录增加管理员标记，成员创建/编辑浮窗可授予与撤销，列表显示状态。
- 管理员成员的分享链接交换成功后进入 `/#/tracker` 管理页；普通成员仍进入 `/#/s/home`。
- LAN listener 上的 Admin API 默认拒绝，仅对有效且 `isAdmin=true` 的成员会话放行；每请求重读成员行，撤权、归档、链接轮换/吊销立即失效。
- 管理壳在 LAN 上先恢复会话并按管理员权限门控；普通成员与无会话显示明确页面。
- 数据库以追加 migration 升级，旧库与旧文件导入保持普通成员。
- 同步设计文档、Agent Note、测试与真实界面的修改前后截图。

## 实施步骤

1. 扩展共享 DTO、成员存储与 v2 migration，补齐成员创建/更新/列表测试。
2. 扩展分享会话、Cookie 与 Admin 守卫，补齐 LAN 放行、普通成员拒绝、撤权立即失效测试。
3. 接入成员编辑/列表 UI、管理员成员链接落地与管理壳入口门控，补齐前端测试。
4. 更新设计文档与 Agent Note，构建真实应用并留存修改前后截图。
5. 运行 `pnpm test`、`pnpm build`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow`。

## 验收标准

- 管理员可以把成员设为管理员，成员列表能看出该状态。
- 管理员成员的分享链接进入管理页并可调用 Admin API 完成管理操作；普通成员和无会话在 LAN 上仍收到 403/明确提示。
- 撤销管理员权限、归档成员或重置/吊销链接后，旧会话不能再调用 Admin API。
- 旧数据库自动升级到 schema v2，旧数据与任务历史不丢失。
- 权限、会话、UI 与文档测试通过，并保留同一场景的修改前后截图。

## 非目标

- 不引入成员注册、密码登录或独立的管理员账号体系。
- 不增加“只读管理员”“任务管理员”等中间权限档。
- 不把管理员 token 放入 URL 或可持久化的前端存储。
