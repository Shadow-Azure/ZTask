# 修复小任务保存错误并完善错误提示

[English](m9-subtask-save-error-reporting.en.md) | 中文

```yaml flow
kind: issue
milestone: m9
priority: P1
status: in-progress
scope:
  - apps/server/**
  - apps/web/**
  - packages/shared/**
  - tests/**
  - .agents/flow/**
  - .agents/notes/**
  - plan/fullstack-design/**
  - reports/**
adr:
  - ../../notes/implemented/bug-fix/2026-11-03-subtask-save-error-reporting.md
github:
  number: 65
  url: https://github.com/Shadow-Azure/ZTask/issues/65
```

## 背景

用户反馈创建小任务后保存报错，界面只提示“内部错误”。当前服务端错误处理把未预期异常统一压成 `INTERNAL_ERROR / 内部错误`，小任务写入载荷又缺少结构校验：非法列表或空条目会抛 `TypeError`，用户既看不到原因，也无法据此修正输入。2026-11-03 在主线构建上按常规点击路径（新建任务带小任务、编辑任务新增小任务、成员个人页添加小任务）未能复现原始 500，因此在保留真实复现限制的前提下，先闭合可复现的 500 路径并把错误提示改成可诊断的输入。

## 目标

- 校验管理端小任务创建/更新载荷结构，非法列表、非法条目与非数组字段返回具体 400，不落盘。
- 服务端未预期异常记录请求编号与堆栈，响应给出可操作原因与请求编号；存储损坏、目录不可写、磁盘不足等常见故障有专门提示。
- 前端对小任务表单做就地校验（描述、负责人、进度），统一把服务端错误码与校验消息翻译成中文动作提示，并保留请求编号供反馈。
- 用集成测试固定非法载荷与存储失败的错误响应，用浏览器冒烟验证保存成功链路与错误提示，并留存修复前后证据。

## 验收

- `subtasks.create/update/deleteIds` 为对象、数字、布尔、字符串或包含 `null` 条目时返回 400 可读提示；任务聚合不产生 revision。
- 模拟 `StorageError` 与 `EACCES` 写入失败时，响应含具体原因与请求编号，不出现裸“内部错误”；服务端日志可按请求编号检索。
- 管理端编辑浮窗缺少小任务负责人或描述为空时就地提示；成员个人页进度为空或越界时就地提示，不发送请求。
- `pnpm test`、`pnpm lint:docs`、相关冒烟回归通过，PR 描述包含修复前后截图与明确的复现限制。
