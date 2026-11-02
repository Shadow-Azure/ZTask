# Agent Note: History Windows, Snapshot Selection and Two-Column Diff Rendering

Status: implemented

English | [中文](2026-11-02-history-window-and-diff-rendering.md)

## Problem

History is only explainable when four things are settled: range boundaries, snapshot selection, permission scoping, and diff rendering. [05](../../../../plan/fullstack-design/05-api-design.md) §5.3/§6.14 and [07](../../../../plan/fullstack-design/07-backend-implementation.md) §8.2 fix `[start,end)`, how before/after are chosen, created/deleted semantics and `currentlyDeleted`, and [08](../../../../plan/fullstack-design/08-frontend-implementation.md) §4.3 mandates jsdiff `diffLines`; but they leave open how local 00:00 maps to UTC, how same-millisecond ties break, how "history of currently related tasks" is scoped for members, how the list is ordered, and how the two-column line model handles a missing trailing newline. These decide whether boundaries miss changes, whether members can see others' history, and whether a one-line append renders as a whole-block replacement.

## Decision

- **The server resolves the range**: `default` = manifest-timezone "yesterday 00:00" → now; `custom` = startDate 00:00 → endDate + 1 day 00:00 (the end date is fully included). The response returns the actual UTC boundaries and the manifest timezone; local 00:00 is converted back to a UTC instant via `Intl.DateTimeFormat`, so DST follows the target zone's rules.
- **Snapshot selection**: `before` is the last revision with `recordedAt < start`, `after` the last with `recordedAt < end`; same-millisecond ties break by `taskVersion`. `after = null` is skipped; `before = null` with a delete after → `deleted`; `before = null` otherwise → `created` (no fake empty origin); otherwise compare progress/detailText and only emit `updated` when either changes — assignment and importance changes are ignored.
- **currentlyDeleted and owners**: `currentlyDeleted` comes from the current aggregate's `deletedAt` at query time (an updated item can be true too); `owners` come from the after/delete snapshot's owner assignments, falling back to "unassigned" when the member file is missing.
- **Member-visible history only trusts main-task assignments**: candidates are aggregates where the member is the current main-task owner/collaborator or appears in the after/delete snapshot's main-task assignment; subtask-only assignees are excluded, otherwise history would return the full parent detail and bypass #18's redaction. `memberIds` may only name members appearing in visible tasks, otherwise 400; admin `memberIds` filter by the after snapshot's owners ∩ active members.
- **Ordering**: non-`currentlyDeleted` items first, `currentlyDeleted` always at the bottom; inside each group sort by `after.recordedAt` descending then `taskId` ascending, so refreshes and pagination stay stable.
- **Diff runs in the frontend**: the server returns full snapshots and never stores diffs. `buildDiffColumns` is a pure function: CRLF→LF, append a trailing newline to non-empty text, then call jsdiff `diffLines` and flatten removed/added/unchanged into two columns (blank placeholders keep rows aligned). Without the newline fixup, jsdiff treats a one-line append as a whole-line delete+add.
- **Rendering safety**: every diff string is rendered through Vue interpolation with no `v-html`; `<script>` only appears as text. Created tasks do not fake an empty-text diff — the left column says "did not exist at start".

## Alternatives considered

- Computing and returning diffs from the server: would put line-level results into the API/storage, contradicting "storage does not save diff results" and removing frontend rendering choices — rejected.
- Computing "yesterday 00:00" in UTC: non-UTC users would see wrong boundaries early in the local morning — rejected; the manifest timezone is authoritative.
- Writing our own LCS: 08 §4.3 already settled on jsdiff, and a home-grown one only adds boundary bugs and maintenance cost — rejected.
- Emitting `updated` for assignment/importance changes: would flood the history list with non-progress changes, while 02 §7 only asks for progress/detail diffs — rejected.
- Adding cursor pagination beyond the DTO: the 05 §5.3 response has no cursor field; this round returns all items in stable order and upgrades the contract when volume demands it — deferred.

## Consequences

- Administrators and members share one history service and one diff component, so boundaries, ordering and badges stay identical; member scope is narrowed before computation.
- Subtask-only assignees have no main-task-level history in this version; a future subtask history must design a separately redacted snapshot projection.
- `currentlyDeleted` updated items also move to the bottom and show the "currently deleted" badge; readability wins over grouping strictly by changeKind.
- Large diffs are computed inside the visible page and cached by component computed properties; there is no Web Worker yet, so very long texts compute on the main thread until real performance data justifies one.
- The two-column model normalizes a missing trailing newline: a pure append no longer renders as a whole-block replacement, while a change in the final newline itself is not surfaced separately.
