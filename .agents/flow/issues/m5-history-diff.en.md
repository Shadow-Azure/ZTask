# Time-range history queries and two-column diffs

English | [中文](m5-history-diff.md)

```yaml flow
kind: issue
milestone: m5
priority: P1
status: done
scope:
  - apps/server/src/modules/revisions/**
  - apps/server/src/modules/dashboard/**
  - apps/server/src/modules/share/**
  - apps/web/src/features/history/**
  - apps/web/src/features/dashboard/**
  - packages/shared/**
  - tests/history/**
  - tests/member-access/**
  - .agents/notes/implemented/feature/2026-11-02-*
  - apps/server/src/index.ts
  - apps/server/src/app.ts
  - apps/web/src/api/share.ts
  - apps/web/src/api/admin.ts
  - pnpm-lock.yaml
  - apps/web/package.json
  - .agents/flow/issues/m5-history-diff*
adr: []
github:
  number: 22
  url: https://github.com/Shadow-Azure/ZTask/issues/22
```

## Background

Full snapshots become useful history only with accurate [start,end) boundaries, member filtering, and safe diff rendering.

## Goals

- Implement default/custom history ranges, stable cursors, and current-related task-set calculation.
- Compute structured line diffs from before/after snapshots with jsdiff diffLines.
- Implement prototype two-column diffs, expansion, currentlyDeleted badges, and bottom placement.

## Design basis

- `plan/fullstack-design/`: 02 §7–8, 05 §5.3 and §6.14, 06 §7, 07 §4, and 08 §7–9.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Changes exactly at start must be included; empty ranges and created/deleted tasks must not fabricate snapshots.
- Scope current-related tasks by member identity before computing changes; history must not reveal other members’ tasks.
- Render diffs as text in Vue without v-html; limit work to the current page and cache by revisionId.

## Steps

1. Write tests for time boundaries, create/delete, empty history, permissions, and XSS first.
2. Implement query services and DTOs, then the two-column component and expansion interactions.
3. Verify large-text limits, stable pagination, and admin/member results.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run history-boundary and diff unit tests, member-isolation tests, and browser review covering empty history, created-then-deleted tasks, currently deleted tasks, and malicious text.

## Acceptance criteria

- Every range boundary and snapshot selection follows the design, with stable pagination.
- Diffs execute no HTML/scripts, and long text cannot block the main thread without bounds.
- Admin and member views show only authorized changes, and deleted items match the prototype.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not add arbitrary event replay, version-rollback UI, HTML diff injection, or cross-member history search.
