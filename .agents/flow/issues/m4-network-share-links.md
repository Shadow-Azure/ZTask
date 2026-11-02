# 动态 LAN 监听与分享链接生命周期

[English](m4-network-share-links.en.md) | 中文

```yaml flow
kind: issue
milestone: m4
priority: P0
status: in-progress
scope:
  - apps/cli/**
  - apps/server/src/modules/network/**
  - apps/server/src/modules/share/**
  - apps/server/src/modules/members/**
  - apps/server/src/bootstrap.ts
  - apps/server/src/app.ts
  - apps/server/src/config.ts
  - apps/server/src/index.ts
  - apps/web/src/features/members/**
  - apps/web/src/pages/MembersPage.vue
  - apps/web/src/layouts/AdminLayout.vue
  - apps/web/src/api/admin.ts
  - apps/web/src/api/network.ts
  - apps/web/src/router/index.ts
  - packages/shared/**
  - plan/fullstack-design/05-api-design.md
  - tests/sharing/**
  - tests/admin-members/**
  - .agents/notes/implemented/feature/2026-11-02-*
  - .agents/flow/issues/m4-network-share-links*
adr:
  - ../../notes/implemented/feature/2026-11-02-lan-share-listener-and-link-lifecycle.md
github:
  number: 20
  url: https://github.com/Shadow-Azure/ZTask/issues/20
```

## 背景

成员协作依赖可分发链接与受控网络暴露；必须确保切换 LAN 只开放分享域，链接轮换和吊销能立即使旧访问失效。

## 目标

- 实现具体 LAN IP 动态监听、关闭和 network.json 的 shareBaseUrl。
- 实现高熵 token 生成、哈希存储、轮换、吊销及受控完整 URL 展示。
- 管理端网络与链接操作复用确认 Dialog，并提示旧链接分发影响。

## 设计依据

- `plan/fullstack-design/`：01 §3–4、05 §4.5–4.10、07 §3、08 §5。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- link 状态是访问兜底；即使残留 session 文件也不能绕过吊销。
- 切换地址不重写 token，新 URL 动态拼接并提示重新分发。
- 所有 LAN 请求在统一 hook 拒绝 Admin API，关闭监听时清理对应连接。

## 实施步骤

1. 先写网络权限、token 哈希和轮换/吊销测试。
2. 实现网络与分享 service/API，再接入管理端操作。
3. 用两个独立浏览器上下文验证旧链接失效和地址切换。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行分享契约与网络集成测试；在 loopback/LAN 两类连接请求 Admin API，并验证生成、轮换、吊销和重启。

## 验收标准

- 默认及 LAN 模式均无 Admin API 越权。
- token 不明文落盘，轮换/吊销后旧链接与旧会话不可用。
- 分享 URL 随 shareBaseUrl 正确变化，UI 不伪称能恢复不可恢复的 secret。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不开放公网、不做用户账号系统、不实现成员页面业务。
