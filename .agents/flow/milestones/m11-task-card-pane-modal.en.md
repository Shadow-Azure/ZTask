# Stage 11: Task card content panes open the modal

English | [中文](m11-task-card-pane-modal.md)

```yaml flow
kind: milestone
id: m11
title: 阶段 11：任务卡内容区打开浮窗
status: active
github:
  number: 11
  url: https://github.com/Shadow-Azure/ZTask/milestone/11
```

Users reported that clicking "subtask progress" or "progress detail" on the task management page does not open the modal; only the card header works. This stage makes both content panes equal entries and adds regression and smoke evidence.

## Delivery boundary

- Only the panes' click/keyboard entry, hint copy, prototype, and regression tests change.
- Modal content, data protocol, permissions, and the read-only pane rendering stay unchanged.
- Separator dragging and text selection stay unchanged: neither opens the modal.

## Stage acceptance

- Either pane opens the edit modal in the admin view and the read-only detail modal in the member view.
- Enter/Space matches clicking and adds no editing controls.
- Regression tests fail before the fix and pass after it; real-build smoke covers before/after evidence.
