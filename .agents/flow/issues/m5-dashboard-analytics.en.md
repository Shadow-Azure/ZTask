# Dashboard metrics, member filters, and due-date distribution

English | [中文](m5-dashboard-analytics.md)

```yaml flow
kind: issue
milestone: m5
priority: P1
status: in-progress
scope:
  - apps/server/src/modules/dashboard/**
  - apps/server/src/modules/share/**
  - apps/server/src/app.ts
  - apps/server/src/index.ts
  - tests/member-access/**
  - apps/web/src/features/dashboard/**
  - .agents/notes/implemented/feature/2026-11-02-*
  - apps/web/src/api/share.ts
  - apps/web/src/api/admin.ts
  - apps/web/src/features/tracker/**
  - packages/shared/**
  - tests/dashboard/**
  - tests/web-shell/**
  - .agents/flow/issues/m5-dashboard-analytics*
adr: []
github:
  number: 21
  url: https://github.com/Shadow-Azure/ZTask/issues/21
```

## Background

The prototype dashboard depends on consistent metric definitions and member scoping, not just charts. Admin and member views must share services to prevent numeric drift.

## Goals

- Implement three metric cards, status/importance stacked bars, member filters, and due-date distribution.
- Use the same metric service for all admin tasks and member-related tasks, with explicit empty-data semantics.
- Implement 15-second polling, background pause, focus refresh, and task/dashboard tabs.

## Design basis

- `plan/fullstack-design/`: 02 §7–8, 05 §5.1–5.2 and §6.12–6.13, 07 §4, and 08 §7–8.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Compute metrics only from active assignments and the effective task sets defined by the design; archived/deleted work is never double-counted.
- Use CSS/SVG charts with accessible text names instead of a heavy chart library.
- Member filters in the share domain must not expose other members.

## Steps

1. Specify metric definitions and boundary fixtures first, including overdue, undated, archived, and deleted work.
2. Implement dashboard services/APIs, then charts and polling.
3. Compare admin and A/B member scopes against the prototype.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run metric unit, API contract, and browser screenshot tests; reconcile every metric card, stacked bar, date panel, and filter result.

## Acceptance criteria

- Cards and charts agree within each data scope, and admin/member boundaries remain correct.
- Empty states, missing due dates, and background polling recovery work without errors.
- Chart visuals, labels, and responsive layout match the prototype.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not add configurable BI, report exports, SSE/WebSocket, or cross-member metric discovery.
