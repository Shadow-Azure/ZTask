# 成员会话、数据隔离与只读事项跟踪

[English](m4-member-access.en.md) | 中文

```yaml flow
kind: issue
milestone: m4
priority: P0
status: in-progress
scope:
  - apps/server/src/modules/share/**
  - apps/server/src/plugins/auth*
  - apps/web/src/features/share/**
  - apps/web/src/features/tracker/**
  - packages/shared/**
  - tests/member-access/**
  - apps/server/src/app.ts
  - apps/server/src/index.ts
  - apps/server/src/modules/folders/**
  - apps/web/src/pages/ShareSessionPage.vue
  - apps/web/src/pages/MemberHomePage.vue
  - apps/web/src/layouts/ShareLayout.vue
  - apps/web/src/api/share.ts
  - apps/web/src/api/http.ts
  - apps/web/src/features/folders/**
  - apps/web/src/pages/TrackerPage.vue
  - apps/web/src/pages/ShareInvalidPage.vue
  - apps/web/src/router/index.ts
  - tests/web-shell/**
  - .agents/notes/implemented/feature/2026-11-02-share-session-boundary*
  - .agents/flow/issues/m4-member-access*
adr:
  - ../../notes/implemented/feature/2026-11-02-share-session-boundary.md
github:
  number: 18
  url: https://github.com/Shadow-Azure/ZTask/issues/18
```

## 背景

分享链接只是凭证，真正安全边界是会话交换、每请求 link 校验和按 memberId 的查询裁剪；UI 隐藏不能替代服务端授权。

## 目标

- 实现 fragment token 换 HttpOnly Cookie、会话恢复/注销和统一失效页。
- 成员任务、详情、树均只返回 owner/collaborator 相关数据。
- 复用 tracker 提供完全只读事项跟踪，成员壳无成员管理入口。

## 设计依据

- `plan/fullstack-design/`：01 §4–5、02 §4–6、05 §6.1–6.5 与 §6.11、07 §3、08 §6–7。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 交换后 replace 清除 fragment，token 不进入 query cache、日志或 Referer。
- 交换端点按来源限流（429 `SHARE_EXCHANGE_RATE_LIMITED`），会话 Cookie 只发往 share 路径。
- 服务端统一构造 member scope，深链和直接 API 同样受限。
- 注销/失效清理 share query cache，浏览器后退不得展示旧私有内容。

## 实施步骤

1. 先写 A/B 成员隔离、会话恢复与失效测试。
2. 实现会话和只读 API，再接入 ShareLayout 与 tracker access=readonly。
3. 验证无 token、已吊销 token、跨成员 taskId 和管理深链。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

用 A/B 隔离浏览器上下文运行权限矩阵与端到端测试，直接请求对方任务、全量树和 Admin API。

## 验收标准

- A 无法通过 UI、深链或 API 获得 B 的私密数据。
- 事项跟踪不渲染或注册任何写操作，刷新/恢复会话仍只读。
- 敏感 token 不出现在持久缓存、日志和后续 Referer 中。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不做成员注册、登录密码、成员管理页或跨成员协作聊天。
