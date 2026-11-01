# 原型细化收尾与走查产物治理

[English](m1-html-prototype-refinement.en.md) | 中文

```yaml flow
kind: issue
id: m1-03
milestone: m1
depends:
  - m1-01
priority: P0
status: in-progress
scope:
  - plan/m1-01-ui-prototype/**
  - .gitignore
  - package.json
  - scripts/prototype-tracker.spec.mjs
  - .agents/notes/implemented/feature/2026-11-01-*
  - .agents/flow/issues/m1-html-prototype-refinement*
adr: []
github:
  number: 8
  url: https://github.com/Shadow-Azure/ZTask/issues/8
```

## 背景

m1-01 走查收尾期产生的界面细化（任务树进度与尺寸调整、只读任务进度卡、仪表盘时间范围与折叠控件）与走查产物治理一直停留在分支上未合入；m1-01 已按原型定稿关闭，这批收尾改动需要独立的流程归属才能通过流程门禁进入主干。

## 目标

- 合入原型走查收尾的三组界面细化，行为与逐屏走查结论一致。
- 为原型追踪结构补上可离线运行的规格测试，纳入 `pnpm test:prototype`。
- 治理本地走查产物：走查报告与 PDF 导出目录不入库。

## 设计依据

- m1-01 定稿的静态原型 `plan/m1-01-ui-prototype/ztask-prototype.html` 与逐屏走查结论。
- 与用户的走查对齐记录（本地 review 产物，按治理约定不入库）。

## 实现内容

- `plan/m1-01-ui-prototype/ztask-prototype.html` 的三组控件细化。
- `scripts/prototype-tracker.spec.mjs` 规格测试与 `package.json` 的 `test:prototype` 脚本。
- 三篇 Agent Note（`.agents/notes/implemented/feature/2026-11-01-*` 三件套）记录三项细化的实现决策。
- `.gitignore` 新增本地走查报告与 PDF 导出目录两条忽略项。

## 实施步骤

1. 细化任务树进度与尺寸调整，并补对应规格。
2. 细化只读任务进度卡，留存走查前后对比截图。
3. 为仪表盘增加时间范围与折叠控件，并补对应规格。
4. 忽略本地走查报告与 PDF 导出目录；建立本 issue 并挂流程门禁合入。

## 依赖与交付边界

- 依赖：m1-01（原型定稿与走查）。
- 交付边界：原型细化、规格测试与忽略规则；不含真实前后端实现。

## 独立验证

```sh
pnpm test:prototype && pnpm verify:docs && node scripts/verify-flow.mjs --diff origin/main
```

- 三条命令均绿；规格测试覆盖任务树进度、只读卡片与仪表盘控件行为。

## 验收标准

- 三组控件在原型页可用，行为与走查结论一致。
- `pnpm test:prototype` 全绿。
- CI 的 build-and-docs 与 flow-online 两个 lane 均绿。

## 门禁与 CI

- 原型、规格、`.gitignore` 与本 issue 三件套的改动全部落在本 issue 的 scope 并集内。
- CI 的 build-and-docs（含 `verify-flow --diff`）与 flow-online（milestone 关联校验）即线上验收。

## 非目标

- 不做任何真实前后端实现。
- 不把本地走查截图与报告改回入库。
