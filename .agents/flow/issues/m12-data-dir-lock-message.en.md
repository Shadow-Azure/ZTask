# Explain the startup error when the data directory is already in use

English | [中文](m12-data-dir-lock-message.md)

```yaml flow
kind: issue
milestone: m12
priority: P2
status: in-progress
scope:
  - apps/server/**
  - apps/cli/**
  - tests/**
  - .agents/**
  - scripts/doc-budgets.manifest.json
adr:
  - ../../notes/implemented/bug-fix/2026-11-04-startup-lock-error-diagnostics.md
github:
  number: 73
  url: https://github.com/Shadow-Azure/ZTask/issues/73
```

## Background

Starting ZTask a second time prints `启动失败：数据目录正被进程 62817 持有`. The message says only who holds the lock: it omits the data directory, the address of the instance that is already running, and whether the user should stop the old process, use that instance, or clear a reused PID. The error alone does not tell the user what to do next.

`acquireDataDirLock()` already knows the lock directory and holder PID, but `LockHeldError` carries only one line of text, and the CLI has no startup context, so the message is printed verbatim. A lock directory with no readable PID shares the same error shape as a live holder, so context is equally thin there.

## Goals

- `LockHeldError` carries the data directory, lock directory, and holder PID so callers do not parse message text.
- `ztask serve` prints a multi-line, actionable conflict error: data directory, known admin URL, platform-specific inspect/stop commands, and the precondition for clearing a reused PID.
- An unreadable PID gets its own explanation: likely causes, lock directory location, and the requirement to confirm no writer exists before deleting it.
- Unit tests pin both error shapes and both platforms; a CLI integration test pins the real startup output; the CLI README is updated.

## Acceptance

- When a live process holds the data directory, stderr includes the PID, data directory, `http://host:port/` when the port is known, the POSIX or Windows inspect/stop commands, and the "if this PID is not ZTask, delete the lock directory" guidance.
- With port `0` or an unreadable PID, the error does not invent an address and gives the correct next step.
- The `dataDir`, `lockDir`, and `pid` of `LockHeldError` are directly asserted by the second-instance rejection test.
- A new CLI integration test starts a real child process while the test process holds the lock, asserts exit code 1, and checks that stderr contains the key facts.
- `pnpm test`, `pnpm lint:docs`, and `pnpm verify:flow` pass; the lock algorithm and exit codes are unchanged.
