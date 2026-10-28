# ZTask 全栈设计文档套件

[English](m1-design-docs.en.md) | 中文

```yaml flow
kind: issue
id: m1-02
milestone: m1
depends:
  - m1-01
priority: P0
status: backlog
scope:
  - docs/design/**
  - docs/README.md
  - scripts/doc-budgets.manifest.json
  - .agents/flow/issues/m1-design-docs*
adr: []
github:
  number: 2
  url: https://github.com/Shadow-Azure/ZTask/issues/2
```

## 背景

原型定稿后，需要把界面形态沉淀成可核对的全栈设计文档，作为后续里程碑、路线与 issue 规划的唯一依据。参照物是 harness-evolution 仓库 `plans/fullstack-design` 目录的文档套件结构。

## 目标

- 在 `docs/design/` 下产出覆盖架构、功能、前端、后端、API、数据设计的全套设计文档。
- 每份文档与用户逐份核对并取得确认。
- 文档套件成为后续研发里程碑规划的直接输入。

## 设计依据

- 定稿的 HTML 原型（m1-01 的交付物）是唯一界面基准。
- 文档套件结构参照 harness-evolution 的 `plans/fullstack-design`：architecture、features、frontend、backend、api、database 等分册。

## 实现内容

- `docs/design/` 下的双语设计文档分册，按上述结构组织，含总览 README。
- 每个分册登记进 docs 索引与词数预算清单。

## 实施步骤

1. 与用户对齐分册清单与写作顺序。
2. 以定稿原型为基准逐册撰写中文侧。
3. 逐册与用户核对、修订、定稿。
4. 补齐英文侧并同步登记索引与预算。

## 依赖与交付边界

- 依赖：m1-01（原型定稿）。
- 交付边界：设计文档本身；不含实现代码、不含后续里程碑的具体规划文本。

## 独立验证

```sh
pnpm verify:docs && pnpm verify:flow
```

- 两条命令均绿；`docs/design/` 每册可从 docs 索引到达。

## 验收标准

- 分册覆盖上述结构且无缺册。
- 用户逐册核对并明确确认。
- 文档套件通过全部文档门禁与流程门禁。

## 门禁与 CI

- 新增文档受双语三件套、换行、死链、索引、词数预算与术语门禁全量管辖。
- CI 的 build-and-docs lane 即为验收命令的线上执行。

## 非目标

- 不做任何实现代码。
- 不规划后续里程碑与 issue（设计文档核对通过后单独规划）。
