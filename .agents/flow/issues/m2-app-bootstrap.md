# CLI、工作区与同源服务启动

[English](m2-app-bootstrap.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: done
scope:
  - apps/cli/**
  - apps/server/**
  - apps/web/**
  - packages/shared/**
  - package.json
  - pnpm-workspace.yaml
  - tsconfig*.json
  - tests/bootstrap/**
  - .agents/flow/issues/m2-app-bootstrap*
  - pnpm-lock.yaml
  - .gitignore
  - .github/workflows/ci.yml
adr: []
github:
  number: 12
  url: https://github.com/Shadow-Azure/ZTask/issues/12
```

## 背景

当前仓库只有原型与文档，缺少能承载后续 API 和页面的可执行工程；需要先固定单进程、同源静态资源与 API 的启动边界。

## 目标

- 建立 pnpm workspace 的 CLI、server、web 与 shared 包。
- 一条命令完成开发启动或生产启动，生产默认仅绑定 127.0.0.1。
- 提供健康检查、优雅退出和可配置数据目录，LAN 上拒绝 Admin API 的钩子留有余量。

## 设计依据

- `plan/fullstack-design/`：01 §2–3、03 §1–3、04 §1–3、07 §1。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 用 Fastify 装配 `/api/v1` 与 Vue 构建产物，CLI 解析 host、port、data-dir。
- 共享包导出 API 前缀、通用错误和基础 DTO；Web 建立 Vite 构建与运行时配置。
- 未知 API 返回统一 404，静态路由回退不得吞掉 API 错误。

## 实施步骤

1. 先写启动与路由回退测试，再创建 workspace 和最小包。
2. 实现 CLI 生命周期与 Fastify 插件装配，最后接入 Vite 页面。
3. 在空数据目录启动并验证重启、端口占用与非 loopback 默认拒绝。

## 依赖与交付边界

- 前置基线：M1 原型与设计；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行 workspace 类型检查、启动集成测试和生产构建；在干净数据目录用 CLI 启动，请求健康检查与 `/api/v1` 未知路由。

## 验收标准

- 新克隆仓库按文档安装后可一条命令打开管理端壳。
- 默认网络只接受 loopback，关闭进程不留下子进程或写任务。
- API 与静态资源同源，API 错误不返回 index.html。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不实现具体任务、成员或分享业务；不引入桌面壳、Docker 或多进程数据库。
