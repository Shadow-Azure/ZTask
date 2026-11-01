# Agent Note: Deleted Task History and Range Boundaries

Status: implemented

English | [中文](2026-11-01-deleted-task-history.md)

## Problem

The backend feasibility review found contract gaps in assignment modeling, revision responses, and history queries. Main-task and subtask assignments were indistinguishable, no-op writes had no valid revision result, exact-start changes could be omitted, and soft-deleted tasks could disappear from history candidates. The prototype also lacked a way to represent a task that is currently deleted but changed during the query window.

## Decision

The aggregate keeps using [current.json](../../../../plan/fullstack-design/06-database-design.md), while assignments now include taskId and are unique by `(taskId,memberId)`. Task writes return the aggregate and a nullable revision, so no-op requests never fabricate snapshots. History uses `[start,end)` and includes soft-deleted candidates, with permissions based on currently related tasks. Created-then-deleted uses deleted as the primary change kind. Responses expose currentlyDeleted independently, and the UI marks those tasks as currently deleted and places them after all non-deleted changes, including when changeKind is updated. The prototype adds a deleted report-migration fixture with a delete revision while excluding it from active trees, lists, counts, and statistics.

## Alternatives considered

`(start,end]` was rejected because it omits changes exactly at start, and an active-only history scope cannot represent deletion. A null before snapshot is not always treated as creation because created-then-deleted requires deleted precedence. changeKind cannot replace currentlyDeleted because deletion may occur after the query window. Deleted tasks do not remain in the active tree because historical visibility and current management scope are different concerns.

## Consequences

[05 API](../../../../plan/fullstack-design/05-api-design.md), [06 storage](../../../../plan/fullstack-design/06-database-design.md), and [07 backend implementation](../../../../plan/fullstack-design/07-backend-implementation.md) now also align subtask DTOs and versions, stable pagination, archive index coordination, missing service methods, and LAN close semantics. Prototype tests cover active/history scopes, half-open boundaries, creation, deleted badges, and deleted-last ordering; all 24 pass. Before and after screenshots are saved as `50-before-deleted-history.png` and `51-after-deleted-history.png`.
