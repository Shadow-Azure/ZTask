# 任务浮窗新增选填方案描述并在整体页可见

[English](m18-task-plan-field.en.md) | 中文

```yaml flow
kind: issue
milestone: m18
priority: P1
status: backlog
scope:
  - plan/**
  - .agents/**
  - reports/**
adr: []
github:
  number: 109
  url: https://github.com/Shadow-Azure/ZTask/issues/109
```

## 背景

2026-11-14 用户反馈：当前任务编辑浮窗只有「任务描述」「任务进展详情」，没有填写实现方案的地方；希望增加一个选填的「方案描述」，填写后在整体页的任务卡上也能直接查看。改动先落在静态原型，附同一场景修改前/后截图，经确认后再开发真实前端。

## 目标

- 任务编辑浮窗新增「方案描述」区块：多行文本，选填，不填不影响保存与校验。
- 数据模型为任务增加 `plan` 字段，随任务一起自动保存。
- 整体页（事项跟踪的任务卡）在「进展详情」旁展示方案：已填写时显示方案文本，未填写时显示占位提示。
- 原型与截图先行：修改前/后截图进入 issue 与 PR，经用户确认后再进 `apps/web` 实现。

## 验收

- 浮窗内方案描述可留空保存、可填写并自动保存，重开浮窗内容保留。
- 任务卡上可查看已填方案；未填写时显示明确的空态文案。
- 同一场景修改前/后截图留存于 `plan/m1-01-ui-prototype/review/` 并在 issue/PR 中引用。

## 原型截图（2026-11-14，基线 main）

- 整体页任务卡 · 修改前：[100-before-plan-field-card.png](../../plan/m1-01-ui-prototype/review/100-before-plan-field-card.png)；修改后：[101-after-plan-field-card.png](../../plan/m1-01-ui-prototype/review/101-after-plan-field-card.png)。「进展详情」上方新增「方案」区块：已填写显示方案文本，未填写显示「未填写方案（选填）」空态。
- 任务编辑浮窗 · 修改前：[102-before-plan-field-modal.png](../../plan/m1-01-ui-prototype/review/102-before-plan-field-modal.png)；修改后：[103-after-plan-field-modal.png](../../plan/m1-01-ui-prototype/review/103-after-plan-field-modal.png)。进度条下新增「方案描述（选填）」多行输入。
