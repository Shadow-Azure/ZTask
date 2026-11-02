# 完善文档工程与门禁自保护

[English](m3-doc-engineering-gates.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P0
status: done
scope:
  - AGENTS.md
  - README*
  - docs/**
  - .agents/flow/README*
  - .agents/flow/issues/m3-doc-engineering-gates*
  - .agents/notes/**
  - package.json
  - scripts/**
adr:
  - ../../notes/implemented/process/2026-11-02-doc-engineering-port.md
github:
  number: 34
  url: https://github.com/Shadow-Azure/ZTask/issues/34
```

## 背景

现有文档门禁已覆盖双语三件套、预算、配对、类型等价和源码引用，但测试仍集中在旧的手写清单里，postmortem、改动面路由、门禁覆盖自检与 CI 接线自保护缺失。新增门禁可能没有对应测试，模式、命令清单或 CI 也可能在无人察觉时脱钩。

## 目标

- 将通用 docs-as-code 门禁拆成独立叶子与独立 spec，排除 `walkthrough` 和应用专属门禁。
- 增加 postmortem、改动面路由、门禁覆盖和接线自保护，并让 `test:gates` 自动发现全部 vitest spec。
- 同步文档规则、常驻文档、命令清单和本次迁移的 Agent Note。

## 验收

- `pnpm lint:docs`、`pnpm verify:docs`、`pnpm test:gates`、`pnpm verify:flow` 与 `pnpm test` 全绿。
- 每个门禁脚本都有同名 spec 或 `gate-coverage` 显式覆盖映射。
- CI 静态 lane、门禁模式与 AGENTS 命令清单由 `ci-wiring` 对账。
