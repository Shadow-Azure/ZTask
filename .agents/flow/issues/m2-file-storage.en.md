# Aggregate file storage and write protocol

English | [中文](m2-file-storage.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: backlog
scope:
  - apps/server/src/storage/**
  - apps/server/src/plugins/**
  - packages/shared/**
  - tests/storage/**
  - .agents/flow/issues/m2-file-storage*
adr: []
github:
  number: 13
  url: https://github.com/Shadow-Azure/ZTask/issues/13
```

## Background

Task and history consistency depends on the file protocol. Letting business modules independently read and write JSON would cause partial files, version mismatches, and unrecoverable history.

## Goals

- Implement one storage interface for the manifest, per-aggregate current.json, revisions.jsonl, indexes, and session files.
- Provide an in-process serialized write queue, data-directory lock, optimistic version recheck, and atomic JSON publication.
- Implement JSONL checksums, partial-tail recovery, current/revisionTip validation, and index rebuilding.

## Design basis

- `plan/fullstack-design/`: 01 §6–7, 04 §5–6, all of 06, and 07 §2.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Write every JSON file through a same-directory temporary file, fsync, and rename; append the full task revision before publishing current for effective changes.
- Expose transactional aggregate writes to services; routes must never manipulate file paths directly.
- Fault injection covers append, current publication, and index updates; corruption inside history must fail explicitly.

## Steps

1. Specify atomic writes, locking, versions, and recovery with temporary-directory tests.
2. Implement file primitives and directory initialization, then aggregate transactions and the revision service.
3. Add index rebuilding and fault-injection tests to verify readable state after restart.

## Dependencies and delivery boundary

- Baseline: the M1 prototype and design; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run storage unit and fault-injection tests while repeatedly terminating writer processes. Compare current, revisionTip, and references after rebuilding indexes.

## Acceptance criteria

- No injected failure allows partial JSON to become valid current state.
- Only one concurrent write succeeds; the other receives a version conflict without duplicate history.
- A valid partial tail is recoverable, while interior checksum corruption is never silently discarded.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not implement business routes, an online-backup UI, or cross-device sync; do not introduce SQLite.
