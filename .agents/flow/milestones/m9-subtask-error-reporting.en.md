# Stage 9: Subtask save errors and diagnosability

English | [中文](m9-subtask-error-reporting.md)

```yaml flow
kind: milestone
id: m9
title: 阶段 9：小任务保存错误与可诊断性
status: done
github:
  number: 9
  url: https://github.com/Shadow-Azure/ZTask/milestone/9
```

A save failure shows only “内部错误”. This stage fixes the Windows revision fsync EPERM and closes validation gaps in the save path so errors state the cause and action.

## Delivery boundary

- Covers the admin task dialogs, the member subtask form, and server-side write validation.
- The error body keeps code/message/requestId; logs record the request id and stack, without exposing private data.
- Existing task, member, and permission rules stay unchanged.

## Stage acceptance

- Invalid subtask payloads return a readable 400, not a 500 “内部错误”.
- Unexpected failures state an actionable cause and request id and record a searchable log.
- Form problems (missing owner, empty description, invalid progress) are reported in place without a request.
- A Windows gate covers append/fsync and the commit path.
- Automated tests and browser smoke cover the fix and pass regression.
