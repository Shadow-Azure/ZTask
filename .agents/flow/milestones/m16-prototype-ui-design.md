# 阶段 15：原型 UI 与详细设计

[English](m16-prototype-ui-design.en.md) | 中文

```yaml flow
kind: milestone
id: m16
title: 阶段 15：原型 UI 与详细设计
status: active
github:
  number: 16
  url: https://github.com/Shadow-Azure/ZTask/milestone/16
```

本阶段根据最新产品需求迭代 `plan/m1-01-ui-prototype/ztask-prototype.html`，先以静态原型确认新的交互与视觉，再同步详细设计和真实实现。流程 id 为 m16，沿用 GitHub milestone 16 的既有标题。

## 交付边界

- 每次原型变更保留同一场景的修改前后截图，并说明基线与修改后分支。
- 原型确认后同步详细设计；真实实现按对应 issue 在 `apps/web` / 服务端落地。
- 权限、数据协议和保存语义以确认后的设计为准。

## 阶段验收

- 原型覆盖本阶段确认的交互与视觉变更，并留存同一场景的修改前后截图。
- 确认后的变更同步到详细设计与真实实现（如适用）。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow` 全绿。
