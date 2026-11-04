# 修复任务卡子任务进展与进展详情点击不出现浮窗

[English](m11-task-card-pane-modal.en.md) | 中文

```yaml flow
kind: issue
milestone: m11
priority: P1
status: in-progress
scope:
  - apps/web/**
  - tests/**
  - plan/**
  - .agents/**
  - reports/**
  - scripts/prototype-tracker.spec.mjs
  - scripts/doc-budgets.manifest.json
adr: []
github:
  number: 71
  url: https://github.com/Shadow-Azure/ZTask/issues/71
```

## 背景

2026-11-04 用户反馈：任务管理页点击任务卡的「子任务进展」和「进展详情」都不会出现浮窗，预期应出现。真实构建 + 真实 API 冒烟复现：点击卡头能打开编辑浮窗（`[role="dialog"]` 数量 1），点击两个内容区块数量均为 0，浏览器无 console error。

根因是 `TaskCard` 只在 `.card-head` 上绑定 `open`，内容区两个 `section.pane` 没有任何点击或键盘入口；列表提示也仍写着「点击任务标题区」。任务卡在内容区之外已经展示子任务与完整进展，用户自然会把内容区当作同一张任务卡的打开入口。

## 目标

- 「子任务进展」与「进展详情」区块和卡头一样打开任务浮窗：管理端编辑浮窗、成员只读详情浮窗。
- 点击与键盘 Enter/Space 等价，区块带 button 语义、tabindex 与打开提示，且不新增任何编辑控件。
- 拖选区块内文本时不误触浮窗；分隔条拖拽与宽度调整行为不变。
- 同步更新原型与列表提示文案；新增 UT / IT 看护，修复前失败、修复后通过。
- 真实构建 + 真实 API 冒烟覆盖修复前后同场景截图，并把报告内容与截图放进 PR 描述。

## 验收

- 管理端点击「子任务进展」或「进展详情」任一区块打开任务编辑浮窗；关闭后点另一区块仍可打开。
- 成员只读视图点击任一区块打开只读详情浮窗，且不请求任何 `/api/v1/admin/**`。
- 区块键盘 Enter/Space 触发打开；拖动分隔条不触发；拖选文本不触发。
- 新增回归用例在修复前失败、修复后通过；`pnpm test`、`pnpm lint:docs`、`pnpm verify:flow` 通过。
- 冒烟报告记录修复前后对照截图与无 console error 的结论，报告与截图仅本地/PR 描述交付，不提交到远端仓库。
