# Fix subtask save errors and improve error reporting

English | [中文](m9-subtask-save-error-reporting.md)

```yaml flow
kind: issue
milestone: m9
priority: P1
status: done
scope:
  - apps/server/**
  - apps/web/**
  - packages/shared/**
  - tests/**
  - .agents/flow/**
  - .agents/notes/**
  - .github/**
  - plan/fullstack-design/**
  - reports/**
  - scripts/doc-budgets.manifest.json
adr:
  - ../../notes/implemented/bug-fix/2026-11-03-subtask-save-error-reporting.md
github:
  number: 65
  url: https://github.com/Shadow-Azure/ZTask/issues/65
```

## Background

A user reported that saving after creating a subtask fails with only “内部错误”. The server currently flattens every unexpected exception into `INTERNAL_ERROR / 内部错误`, and subtask write payloads lack structural validation: invalid lists or `null` entries throw `TypeError`, so users see neither the cause nor a way to correct their input. The user then confirmed the root cause locally: on Windows, revision append called `FileHandle.sync()` on a read-only handle; `FlushFileBuffers` requires write access and returned `EPERM`. Every save appends a revision, so every save failed with a 500 on Windows. The fix writes and fsyncs through an append-mode handle, skips directory fsync on Windows, and adds a `windows-latest` storage gate.

## Goals

- Validate admin subtask create/update payload structure; invalid lists, invalid entries, and non-array fields return a specific 400 without writing.
- Log unexpected server exceptions with the request id and stack; responses state an actionable cause and the request id, with dedicated text for storage corruption, unwritable directories, and low disk space.
- Validate subtask forms in place (description, owner, progress), translate server error codes and validation messages into Chinese action guidance, and keep the request id for feedback.
- Pin invalid-payload and storage-failure responses with integration tests, verify the success path and error reporting in browser smoke, and retain before/after evidence.
- Fix the Windows read-only-handle fsync EPERM and cover JSONL append, atomic writes, and the task-store commit path with a `windows-latest` gate.

## Acceptance

- When `subtasks.create/update/deleteIds` is an object, number, boolean, string, or contains `null` entries, the API returns a readable 400 and the task aggregate gets no new revision.
- With an injected `StorageError` or `EACCES` write failure, the response names the specific cause and request id and never shows a bare “内部错误”; the server log is searchable by request id.
- The admin editor reports a missing subtask owner or empty description in place; the member personal page reports empty or out-of-range progress in place without sending a request.
- `pnpm test`, `pnpm lint:docs`, and the relevant smoke regression pass; the PR description contains before/after screenshots.
- `windows-storage` passes on `windows-latest` and covers the JSONL, atomic-write, and task-store commit paths.
