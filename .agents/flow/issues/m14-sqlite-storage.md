# 用 SQLite 单库取代分聚合文件存储

[English](m14-sqlite-storage.en.md) | 中文

```yaml flow
kind: issue
milestone: m14
priority: P1
status: in-progress
scope:
  - apps/server/**
  - apps/cli/**
  - packages/shared/**
  - tests/**
  - plan/fullstack-design/**
  - .agents/**
  - .gitignore
  - .github/**
  - docs/**
  - reports/**
  - README.md
  - README.en.md
  - README.i18n.yaml
  - package.json
  - pnpm-lock.yaml
  - scripts/doc-budgets.manifest.json
adr:
  - ../../notes/implemented/architecture/2026-11-05-sqlite-storage.md
github:
  number: 79
  url: https://github.com/Shadow-Azure/ZTask/issues/79
```

## 背景

当前存储把成员、任务夹、任务聚合、历史、分享链接、会话和网络配置拆成 JSON/JSONL 文件，应用层自维护原子写、JSONL 尾行恢复、current 与 revision tip 对账和启动索引重建。用户要求改为 SQLite，并先评审设计文档。

## 目标

- 设计并落实 `ztask.db` schema：当前状态关系化，历史保存完整快照，事务写协议。
- 旧文件一次性导入、旧备份兼容、schema migration、`VACUUM INTO` 备份与恢复、doctor 校验。
- 保持现有 API DTO、权限、看板口径和历史 diff 语义不变。

## 设计依据

- `plan/fullstack-design/`：01 §2/§6–§8、04 §1/§5、06 全文、07 §1/§2/§9、09。
- Agent Note：`../../notes/implemented/architecture/2026-11-05-sqlite-storage.md`。

## 实施步骤

1. 设计文档评审通过后，补 SQLite schema、连接/事务封装与仓储。
2. 迁移任务聚合、成员、任务夹、分享和网络配置写入路径。
3. 实现旧数据导入、备份/恢复/doctor 和一致性校验。
4. 替换存储测试并跑全量门禁。

## 依赖与交付边界

- 前置：设计评审确认；本 issue 的 ready 状态不代表已开始实施。
- 交付范围以上述 scope 为准；跨范围改动先扩 scope 并说明。
- 不改变 UI 与 API 契约；驱动选择见 06 §11。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:docs && pnpm verify:flow
```

旧数据导入用真实或合成数据目录验证；事务提交前中止、migration 失败、备份恢复分别覆盖。

## 验收标准

- 旧数据导入后任务、历史、成员、链接、会话、网络配置和 revision checksum 完整。
- 事务提交/回滚、版本冲突、WAL 恢复、备份恢复和 doctor 均有测试。
- 现有 API、权限、看板与历史行为不回归。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready/in-progress。
- 必过 `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新架构决策更新同一 Agent Note；实施完成后从 proposed 归档为 implemented。

## 非目标

- 不引入独立数据库服务、ORM 或多进程共享数据库；不改变 UI/API 契约；不做跨机同步。
