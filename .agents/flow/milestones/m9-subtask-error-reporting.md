# 阶段 9：小任务保存错误与可诊断性

[English](m9-subtask-error-reporting.en.md) | 中文

```yaml flow
kind: milestone
id: m9
title: 阶段 9：小任务保存错误与可诊断性
status: done
github:
  number: 9
  url: https://github.com/Shadow-Azure/ZTask/milestone/9
```

保存失败只提示“内部错误”。本阶段修复 Windows 上 revision fsync 的 EPERM 与保存链路校验缺口，让错误说明原因与下一步动作。

## 交付边界

- 覆盖管理端任务浮窗、成员页小任务表单与服务端写入校验。
- 错误体保持 code/message/requestId；日志记录请求编号与堆栈，不泄露私有数据。
- 不改变任务、成员与权限的既有业务规则。

## 阶段验收

- 非法小任务载荷返回可读 400，而非 500“内部错误”。
- 未预期异常给出可操作原因与请求编号，并记录可检索日志。
- 表单问题（缺少负责人、空描述、非法进度）就地提示，不发送请求。
- Windows 门禁覆盖 append/fsync 与提交路径。
- 自动化测试与浏览器冒烟覆盖修复并回归通过。
