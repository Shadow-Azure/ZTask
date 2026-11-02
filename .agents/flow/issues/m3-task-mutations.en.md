# Task aggregates, editor, and historical writes

English | [中文](m3-task-mutations.md)

```yaml flow
kind: issue
milestone: m3
priority: P0
status: in-progress
scope:
  - apps/server/src/modules/tasks/**
  - apps/server/src/modules/revisions/**
  - apps/web/src/features/tasks/**
  - packages/shared/**
  - tests/admin-tasks/**
  - apps/server/src/app.ts
  - apps/web/src/pages/TrackerPage.vue
  - .agents/flow/issues/m3-task-mutations*
adr: []
github:
  number: 16
  url: https://github.com/Shadow-Azure/ZTask/issues/16
```

## Background

Root tasks and one-level subtasks are the product core. Their fields, assignments, versions, and history must be implemented coherently rather than interpreted separately by UI and storage.

## Goals

- Implement task queries, creation, full-detail reads, progress/detail updates, editor PUT, and soft deletion.
- Support one-level subtasks, owner/collaborator assignments, importance, due dates, and aggregate versions.
- Append a full snapshot for every effective change and preserve user drafts on 409.

## Design basis

- `plan/fullstack-design/`: 02 §3, 05 §3.4–3.9, 06 §6–8, 07 §3–4, and 08 §4.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Centralize hierarchy, role, archived-member, and field invariants in services; PUT replaces only fields allowed by the design.
- Implement create/edit dialogs, full details, subtask management, and deletion confirmation in the frontend.
- Invalidate list, detail, and tree queries by key after mutations without overwriting unsaved drafts with stale responses.

## Steps

1. Define DTOs, error codes, and concurrency/history contract tests first.
2. Implement task services and APIs, then the editor and cache updates.
3. Verify no-op writes, soft deletion, rejection of second-level subtasks, and conflict recovery.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run task API, revision, and editor component tests. Save concurrently from two clients, confirm one 409 with retryable drafts, and inspect snapshots after restart.

## Acceptance criteria

- Admins can complete root-task and subtask lifecycles with fields matching the designed DTOs.
- No-op changes create no revisions, and soft deletion preserves history.
- Concurrent conflicts are visible and recoverable without losing unsubmitted text.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not implement history-query UI, member writes, dashboard metrics, or permanent physical deletion.
