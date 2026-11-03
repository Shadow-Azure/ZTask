# Stage 8: Task management prototype filter refinement

English | [中文](m8-prototype-filter-refinement.md)

```yaml flow
kind: milestone
id: m8
title: 阶段 8：任务管理原型筛选补充
status: active
github:
  number: 8
  url: https://github.com/Shadow-Azure/ZTask/milestone/8
```

The task management prototype adds an assignee filter alongside importance and search, with distinct matching scopes for main-task owners and subtask owners.

## Delivery boundary

- Change only the static prototype, specification tests, and review screenshots; do not change the real `apps/web` implementation, server APIs, or storage.
- The filter applies only to main tasks and subtasks under the selected folder; it does not change task-tree counts or dashboard statistics.

## Stage acceptance

- The task management toolbar provides a multi-select assignee dropdown that works together with importance and search.
- A main-task owner match shows the whole task with every subtask; a subtask-owner-only match keeps the main task but shows only the matching subtasks.
- Specification tests, documentation gates, and flow gates pass, and before/after review screenshots are retained.
