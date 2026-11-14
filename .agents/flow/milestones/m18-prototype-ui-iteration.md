# 阶段 17：原型 UI 迭代

[English](m18-prototype-ui-iteration.en.md) | 中文

```yaml flow
kind: milestone
id: m18
title: 阶段 17：原型 UI 迭代
status: active
github:
  number: 19
  url: https://github.com/Shadow-Azure/ZTask/milestone/19
```

本阶段承接 m16 的原型迭代机制：按最新产品需求持续迭代 `plan/m1-01-ui-prototype/ztask-prototype.html`，先以静态原型与修改前/后截图确认交互与视觉，再同步详细设计与真实实现。

## 交付边界

- 每次原型变更保留同一场景的修改前/后截图，并说明基线与修改后分支。
- 原型经用户确认后同步详细设计；真实实现按对应 issue 在 `apps/web` / 服务端落地。
- 数据协议与保存语义以确认后的设计为准。

## 阶段验收

- 原型覆盖本阶段确认的交互与视觉变更，并留存同一场景的修改前/后截图。
- 确认后的变更同步到详细设计与真实实现（如适用）。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs` 与 `pnpm verify:flow` 全绿。
