# Agent Note: Dashboard Metric Scope and Two-Domain Reuse

Status: implemented

English | [中文](2026-11-02-dashboard-metrics-scope.md)

## Problem

The dashboard serves both administrators (whole team, optional member filter) and members (their own related tasks). [02](../../../../plan/fullstack-design/02-features.md) §7 and [05](../../../../plan/fullstack-design/05-api-design.md) §5.1–5.2 / §6.12–6.13 fix the three buckets, importance counts, member filter, and due distribution, but leave four things open: how the member domain reuses the same statistics, whether assignments to archived owners count as active, whether `dueDate=null` enters the distribution, and which timezone defines "today". These decide whether both sides show the same numbers and whether empty data is explainable.

## Decision

- **One service for both domains**: `createDashboardService({ dataDir, timeZone })` backs both admin and share routes; the only difference is the task scope: administrators get the folder plus descendants (optionally filtered by memberIds), members get `isRelated` tasks intersected with the folder scope.
- **Main tasks only**: skip soft-deleted tasks and `deletedAt !== null` subtasks so parent and child are never double counted.
- **Active assignment semantics**: the member filter only matches assignments where a non-archived member is the main-task owner; empty selection means all members, multiple members are OR-ed; `memberIds` must be UUIDs or 400; well-formed but archived/unknown IDs yield an empty 200.
- **The member domain rejects `memberIds`**: any such parameter returns 400 so the dashboard cannot be used to probe other members' workload; a missing session still returns 401 first.
- **Three disjoint buckets**: `done=100`, `gt50=51–99`, `lt50=0–50`, each with high/mid/low from the main task's `importance`.
- **Due distribution uses the manifest timezone**: `Intl.DateTimeFormat("en-CA", { timeZone })` derives "today", then UTC date differences map to `overdue(<0)`, `week(0–7)`, `month(8–30)`, `later(>30)`; `dueDate=null` is excluded (the DTO has no "unscheduled" key) and the response always carries four buckets; `asOf` and "today" share one clock.
- **Unknown folderId is an explicit empty scope**: orphan tasks are not counted and no 404 is returned, matching the task list's empty-set semantics.

## Alternatives considered

- Separate admin and member statistics code: numbers would inevitably drift and filters/boundaries would need two implementations — rejected.
- Bucketing `dueDate=null` as `later`: makes "not scheduled" look like "due in over a month" and misleads planning — rejected; recorded as a known gap until the DTO gains an unscheduled bucket.
- Filtering by any assignment (owner/collaborator): collaborators would inflate their own numbers and contradict 02 §7's owner semantics — rejected.
- Computing "today" in UTC: users in China would see yesterday's bucket before 08:00 local — rejected; the manifest timezone is authoritative.
- Offering a member filter in the member domain but cropping results: numeric differences still leak other members' workload — rejected.

## Consequences

- For the same scope, administrators and members see identical three-bucket and due distributions; the member domain has no member filter UI.
- Main tasks with `dueDate=null` count in the three stat cards but not in the due distribution; adding an "unscheduled" bucket later requires syncing 05 §2.2 and the frontend legend.
- Dashboard data is recomputed from the same derived reads on every request (no separate cache); 15s polling and background pause are frontend concerns (03 §7).
