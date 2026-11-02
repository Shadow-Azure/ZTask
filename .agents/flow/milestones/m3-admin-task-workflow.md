# 阶段 3：管理端任务闭环

[English](m3-admin-task-workflow.en.md) | 中文

```yaml flow
kind: milestone
id: m3
title: 阶段 3：管理端任务闭环
status: done
github:
  number: 3
  url: https://github.com/Shadow-Azure/ZTask/milestone/3
```

把原型中的任务夹、成员档案和事项跟踪转化为真实管理能力，贯通任务树、统一只读卡、编辑浮窗与版本冲突反馈。

## 交付边界

- 只交付本阶段 issue 声明的能力，后续阶段功能不以隐藏实现提前混入。
- 所有实现遵循 `plan/fullstack-design/` 与定稿原型；非平凡决策登记 Agent Note。

## 阶段验收

- 管理员可维护嵌套任务夹、成员、主任务与一层小任务，重启后数据保持。
- 事项跟踪的筛选、树、卡片、详情、进度和编辑器符合原型与 API 不变量。
- 有效任务变更生成完整历史快照，并发修改返回可恢复的 409。
