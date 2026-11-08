# Dashboard card task list and task dialog

English | [中文](m16-dashboard-card-task-list.md)

```yaml flow
kind: issue
milestone: m16
priority: P1
status: ready
scope:
  - plan/m1-01-ui-prototype/**
  - plan/fullstack-design/**
  - scripts/prototype-tracker.spec.mjs
  - scripts/doc-budgets.manifest.json
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m16-*
  - .agents/flow/issues/m16-*
  - .agents/notes/implemented/feature/2026-11-08-dashboard-card-task-list*
  - apps/web/src/**
  - apps/server/src/**
  - packages/shared/src/**
  - tests/dashboard/**
adr:
  - ../../notes/implemented/feature/2026-11-08-dashboard-card-task-list.md
github:
  number: 92
  url: https://github.com/Shadow-Azure/ZTask/issues/92
```

## Background

The dashboard stat cards expand only the due-date distribution chart, so after seeing "2 done" or "3 in progress" users cannot tell which tasks make up the number and cannot open a task directly from the statistic. The task management list carries CRUD and filtering, so it is not a good second step for "check the statistic, then inspect the details". The prototype layout was confirmed by the user through screenshots, and the work now moves to the real implementation.

## Goals

- Show the paginated task list below the chart in the real `apps/web` dashboard.
- Keep it concise and compact: 5 rows per page with importance, description, owners, progress, and due date.
- Clicking a row opens the existing task dialog: the admin edit dialog in the admin scope and the read-only detail dialog in the member scope.
- Reset to page one when the card, member filter, or folder changes; keep pagination valid across refreshes.
- Keep the list read-only and leave the three stat cards and distribution chart semantics unchanged.

## Implementation

- `packages/shared/src`: add and export the dashboard task row and paginated response DTOs (`DashboardTaskListItem`, `DashboardTasks`).
- `apps/server/src/modules/dashboard`: reuse the folder/member/share scope in `scopedAggregates`; add progress-bucket filtering, stable `createdAt,id` sorting, and opaque cursor pagination for the task list; add `GET /dashboard/tasks` for admin and share.
- `apps/web/src/api`: add `dashboardTasks` for admin and share.
- `apps/web/src/features/dashboard/DashboardPanel.vue`: task list below the chart, 5 rows per page, cursor-stack paging, loading/error/empty states, 15s refresh, and `openTask` emission on row click.
- `apps/web/src/features/tracker/TrackerView.vue`: reuse the task-open path for dashboard rows (admin edit dialog / member read-only detail).
- `tests/dashboard`: server cursor, bucket filtering, member/share scope, invalid cursor; component list rendering, paging, reset, and row event tests.
- `plan/m1-01-ui-prototype/review/90–98`: actual-app before/after captures and the dialog screenshot.
- The confirmed static prototype, specification tests, and review captures remain in the same PR.

## Independent verification

```sh
pnpm test
pnpm lint:docs
pnpm verify:docs
pnpm verify:flow
```

- `pnpm test`: 64 test files and 476 tests pass, including the new dashboard API/component cases.
- Real app checked at a 1440×1000 viewport with 2026-11-08 data: page 1 shows 5 rows and footer `1 / 2`; page 2 shows the remaining 2 rows; clicking a row opens the matching task dialog.
- Documentation, pairing, type, and flow gates pass.

## Non-goals

- Do not change the three stat cards, the due distribution, the history panel, or member visibility.
- Do not redo the task management list or add a new task data protocol.
