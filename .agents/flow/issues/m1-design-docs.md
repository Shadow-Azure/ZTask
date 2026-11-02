# ZTask 全栈设计文档套件

[English](m1-design-docs.en.md) | 中文

```yaml flow
kind: issue
milestone: m1
priority: P0
status: done
scope:
  - plan/fullstack-design/**
  - .agents/flow/**
  - .agents/skills/**
  - .agents/notes/implemented/process/2026-11-01-engineering-flow-tree*
  - scripts/flow-*
  - scripts/verify-flow*
  - scripts/run-gates.mjs
  - scripts/gates.spec.mjs
  - scripts/spec-fixture.mjs
  - scripts/doc-budgets.manifest.json
  - pnpm-lock.yaml
  - AGENTS.md
  - package.json
  - .agents/flow/issues/m1-design-docs*
adr:
  - ../../notes/implemented/process/2026-11-01-engineering-flow-tree.md
github:
  number: 2
  url: https://github.com/Shadow-Azure/ZTask/issues/2
```

## 背景

原型定稿后，需要把界面形态沉淀成可核对的全栈设计文档，作为后续里程碑、路线与 issue 规划的唯一依据。参照物是 harness-evolution 仓库 `plans/fullstack-design` 目录的文档套件结构。套件实际落位 `plan/fullstack-design/`，与参照目录同名同构；scope 按实际落位声明，原先预留的 `docs/design/` 路径与 docs 索引、词数预算登记随之取消。

## 目标

- 在 `plan/fullstack-design/` 下产出覆盖架构、功能、前端、后端、API、数据设计的全套设计文档。
- 每份文档与用户逐份核对并取得确认。
- 以文档套件为直接输入拆分研发 roadmap、milestone 与 issue，并同步流程门禁和项目 skills。

## 设计依据

- 定稿的 HTML 原型（m1-01 的交付物）是唯一界面基准。
- 文档套件结构参照 harness-evolution 的 `plans/fullstack-design`：architecture、features、frontend、backend、api、database 等分册。

## 实现内容

- `plan/fullstack-design/` 下的设计文档分册（中文 base），按上述结构组织，含总览 README；英文侧随逐册核对补齐。
- `.agents/flow/` 的 M2–M5 研发流程树，以及与 StudyWiki 一致的流程门禁、门禁测试和 `.agents/skills/`。

## 实施步骤

1. 与用户对齐分册清单与写作顺序。
2. 以定稿原型为基准逐册撰写中文侧。
3. 逐册与用户核对、修订、定稿。
4. 补齐英文侧。
5. 拆分研发流程树，拷贝流程机制与 skills，并运行门禁验证。

## 依赖与交付边界

- 依赖：m1-01（原型定稿）。
- 交付边界：设计文档、研发流程树与流程工具；不含产品前后端实现代码。

## 独立验证

```sh
pnpm verify:docs && pnpm verify:flow
```

- 两条命令均绿；`plan/fullstack-design/` 每册通过现行文档门禁。

## 验收标准

- 分册覆盖上述结构且无缺册。
- 用户逐册核对并明确确认。
- 文档套件通过全部文档门禁与流程门禁。

## 门禁与 CI

- 分册受换行、死链、术语等现行文档门禁管辖；英文侧补齐后进入双语三件套契约。
- CI 的 build-and-docs lane 即为验收命令的线上执行。

## 非目标

- 不做任何实现代码。
- 不实现 M2–M5 所规划的产品功能，不在本次同步 GitHub 远端对象。
