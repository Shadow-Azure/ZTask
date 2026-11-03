# 冒烟回归缺陷修复与 v2 验证

[English](m6-smoke-regression-fixes.en.md) | 中文

```yaml flow
kind: issue
milestone: m6
priority: P2
status: in-progress
scope:
  - .agents/flow/**
  - apps/server/**
  - apps/web/**
  - tests/**
  - .agents/notes/**
  - plan/fullstack-design/**
  - reports/**
adr: []
github:
  number: 59
  url: https://github.com/Shadow-Azure/ZTask/issues/59
```

## 背景

发布前全功能 GUI 冒烟发现三个 P1 缺陷：新建任务丢失小任务草稿、删除成功后确认层残留、LAN 关闭后重开使用旧端口。这些缺陷横跨任务聚合 API、编辑器生命周期和网络分享表单，需要一次闭环修复并用自动化与 v2 GUI 回归共同验证。

## 目标

- 修复新建任务时子任务草稿的持久化链路，补齐 API 与组件看护。
- 修复删除成功后的确认层和编辑器状态生命周期。
- 修复 LAN 关闭后表单端口回落到实际 loopback 端口的行为。
- 固化首轮失败证据、修复说明与 v2 全功能冒烟报告。

## 验收

- `pnpm lint:docs` 与 PR CI 全绿。
- 自动化测试覆盖创建子任务、删除确认层关闭和 LAN 端口恢复。
- v2 冒烟报告确认 27 个场景通过，且三个首轮 P1 缺陷不再复现。
