# 界面与原型逐屏对齐与差异清零

[English](m6-ui-parity.en.md) | 中文

```yaml flow
kind: issue
milestone: m6
priority: P2
status: in-progress
scope:
  - apps/web/**
  - apps/server/**
  - packages/**
  - tests/**
  - .agents/flow/**
  - .agents/notes/**
  - scripts/doc-budgets.manifest.json
adr: []
github:
  number: 55
  url: https://github.com/Shadow-Azure/ZTask/issues/55
```

## 背景

`plan/m1-01-ui-prototype/ztask-prototype.html` 是定稿界面基准；此前交付的 web 在布局、样式、文案与交互细节上存在系统性差异，需要逐屏收敛到与原型一致。

## 目标

- 以原型为唯一基准逐屏对比管理端与成员端，产出可执行的差异清单并修复。
- 关键交互、空态与边界态与原型一致；差异清零或以裁决与理由留档。
- 同步受影响的 DTO 与单元测试，本地与 CI 门禁全绿。

## 设计依据

- `plan/m1-01-ui-prototype/ztask-prototype.html`：界面与交互基准。
- `plan/fullstack-design/`：页面边界、数据契约与权限口径。

## 实现内容

- 管理端与成员端逐屏对齐：appbar、任务夹树、任务卡、看板、变化面板、成员页与分享链接单元格等。
- `TaskChange` 增加重要度字段，供变化列表行首色点使用。
- 单测同步到新的 DOM 结构、文案与脱敏形态。

## 实施步骤

1. 对比 subagent 逐屏取证并输出差异清单。
2. 修复 subagent 按清单修复，下一轮复核确认。
3. 全部差异收敛后提交并通过 CI。

## 依赖与交付边界

- 前置基线：roadmap 全部前序里程碑已完成；本 issue 只交付还原对齐与必要同步。
- 代码改动限制在 scope；不引入原型之外的新功能。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:docs && pnpm verify:flow
```

以 1440×900 视口打开管理端与成员端关键页面，与原型逐屏对照。

## 验收标准

- 逐屏对比无残留可行动差异（凡保留差异均有裁决与理由）。
- 单测、构建、文档与 CI 门禁全绿。

## 门禁与 CI

- PR 标题与本分支提交标题引用本 issue 的 GitHub `(#N)`。
- 必过 `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow`；CI 另跑 PR diff scope 与 GitHub 双侧一致性。

## 非目标

- 不追逐原型之外的新视觉或新功能；不扩大安全边界以换取还原度。
