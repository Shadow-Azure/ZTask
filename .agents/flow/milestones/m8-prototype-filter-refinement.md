# 阶段 8：任务管理原型筛选补充

[English](m8-prototype-filter-refinement.en.md) | 中文

```yaml flow
kind: milestone
id: m8
title: 阶段 8：任务管理原型筛选补充
status: active
github:
  number: 8
  url: https://github.com/Shadow-Azure/ZTask/milestone/8
```

任务管理原型在重要度与搜索之外补齐负责人筛选，并明确主任务负责人与子任务负责人的不同命中范围。

## 交付边界

- 只修改静态原型、全栈设计文档、规格测试与评审截图，不改 `apps/web` 实际实现、服务端接口与存储。
- 筛选只作用于当前任务夹内的主任务与子任务，不改变任务树计数与情况看板统计口径。

## 阶段验收

- 任务管理工具栏提供负责人多选下拉，可与重要度、搜索同时生效。
- 主任务负责人命中时显示整条任务及全部子任务；仅子任务负责人命中时保留主任务并只显示对应子任务。
- 规格测试、文档门禁与流程门禁通过，评审留存修改前后对比截图。
