# Stage 12: Diagnosable startup-occupancy errors

English | [中文](m12-startup-occupancy-error.md)

```yaml flow
kind: milestone
id: m12
title: 阶段 12：启动占用错误可诊断
status: active
github:
  number: 12
  url: https://github.com/Shadow-Azure/ZTask/milestone/12
```

Running `pnpm serve` again while another process already owns the data directory only prints "启动失败：数据目录正被进程 N 持有". The user cannot tell whether to stop the old process, use the instance that is already running, or clear a PID that was reused. This stage gives that error enough context and executable next steps.

## Delivery boundary

- Only the data-directory lock conflict error changes: `LockHeldError` carries structured context and the CLI renders platform-specific next steps.
- Lock acquisition/takeover, exit codes, health checks, and automatic stop behavior stay unchanged.
- No automatic kill, automatic port fallback, or reuse of a running instance is added.

## Stage acceptance

- When a live process holds the data directory, the error names the PID, data directory, known admin URL, the current platform's inspect/stop commands, and the PID-reuse handling.
- When the holder PID cannot be read, the error explains the likely causes and names the lock directory plus the precondition for clearing it.
- Unit tests cover both errors and both platforms; a CLI integration test verifies the real startup output; the CLI README is updated.
