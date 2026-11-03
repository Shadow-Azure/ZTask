# Stage 9: Subtask save errors and diagnosability

English | [中文](m9-subtask-error-reporting.md)

```yaml flow
kind: milestone
id: m9
title: 阶段 9：小任务保存错误与可诊断性
status: active
github:
  number: 9
  url: https://github.com/Shadow-Azure/ZTask/milestone/9
```

A subtask save failure shows only “内部错误”, leaving users unable to tell why. This stage closes validation gaps in the save path and makes errors state the cause and next action.

## Delivery boundary

- Covers the admin task dialogs, the member personal-page subtask form, and server-side write validation.
- The error body keeps code/message/requestId; logs record the request id and stack, while responses expose no private data.
- Existing task, member, and permission rules stay unchanged.

## Stage acceptance

- Invalid subtask payloads return a readable 400, not a 500 “内部错误”.
- Unexpected failures state an actionable cause and request id and leave a searchable log.
- Form problems (missing owner, empty description, invalid progress) are reported in place without a request.
- Automated tests and browser smoke cover the fix and pass regression.
