# Agent Note: Diagnosable data-directory occupancy errors

Status: implemented

English | [中文](2026-11-04-startup-lock-error-diagnostics.md)

## Problem

When a `ztask serve` already owns the data directory, a second instance prints only `启动失败：数据目录正被进程 N 持有`. The message omits the data directory, the address of the running instance, and whether the user should stop the old process, use that instance, or clear a reused PID. A lock directory with no readable PID shares the same path as a live holder. `acquireDataDirLock()` already knows the lock directory and PID, but `LockHeldError` keeps only one line of text and the CLI does not carry startup configuration into the error path, so the information is lost at the error-object boundary.

## Decision

`LockHeldError` gains three read-only facts: `dataDir`, `lockDir`, and `pid`. `acquireDataDirLock()` reads the PID once at the throw site and builds the error there, so callers no longer parse message text. `runServe()` catches the lock conflict in the CLI and renders a multi-line message through a pure function keyed on `process.platform`: the first line keeps `启动失败：…`, followed by the data directory, the known admin URL, the current platform's inspect/stop commands, and the "if this PID is not ZTask, confirm no writer exists before deleting the lock directory" guidance. With `--port 0` or an unreadable PID the message invents no address and uses a separate explanation.

The exit code stays 1, and lock acquisition/takeover, health checks, and automatic stop behavior are unchanged. Presentation stays in the CLI because the server does not know this invocation's host/port and should not own terminal copy. Unit tests and a child-process integration test pin the message together with the CLI README.

## Alternatives considered

Putting the full multi-line copy inside `LockHeldError` was rejected: the server lacks the CLI's startup context, terminal commands and platform detection belong to presentation, and other callers would inherit the same copy. Probing `/api/v1/health` on conflict and changing the exit code to 0 was rejected: it changes startup semantics, adds a network timeout to the failure path, and can mislead when the port is reused or the running instance uses another port. Automatically stopping the old process was rejected: preempting a live writer is riskier than the alternative and conflicts with the server's "cannot assume you are the only writer" constraint. Printing both POSIX and Windows command sets was rejected: most of it is irrelevant on the current platform and adds noise.

## Consequences

Users can decide directly which instance to use, which process to stop, and when clearing the lock is safe, while the original first line stays available for scripts or older docs that match it. The cost is that the copy is a contract shared by the CLI README and tests, so adding a platform or changing a command must update both. If the holder was started with another port, the printed URL is only a hint for this invocation's configuration, and the user must still use the address the old instance printed at startup. Lock behavior, exit codes, and data-directory contents are unchanged.
