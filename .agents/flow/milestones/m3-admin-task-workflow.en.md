# Stage 3: Admin task workflow

English | [中文](m3-admin-task-workflow.md)

```yaml flow
kind: milestone
id: m3
title: 阶段 3：管理端任务闭环
status: planned
github:
  number: 3
  url: https://github.com/Shadow-Azure/ZTask/milestone/3
```

Turn folders, member records, and the tracker prototype into real admin capabilities across the task tree, unified read-only cards, the editor dialog, and version-conflict feedback.

## Delivery boundary

- Deliver only the capabilities declared by this stage's issues; do not hide later-stage features in early implementations.
- Follow `plan/fullstack-design/` and the approved prototype for all implementation; record non-trivial decisions as Agent Notes.

## Stage acceptance

- Admins can manage nested folders, members, root tasks, and one level of subtasks, with data retained after restart.
- Tracker filtering, tree, cards, details, progress, and editing follow the prototype and API invariants.
- Every effective task change appends a full historical snapshot, and concurrent edits return a recoverable 409.
