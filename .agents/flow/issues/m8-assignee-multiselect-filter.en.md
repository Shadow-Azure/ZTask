# Add an assignee multi-select filter to the task management prototype

English | [中文](m8-assignee-multiselect-filter.md)

```yaml flow
kind: issue
milestone: m8
priority: P1
status: done
scope:
  - plan/m1-01-ui-prototype/**
  - plan/fullstack-design/**
  - apps/server/**
  - apps/web/**
  - packages/shared/**
  - tests/**
  - reports/**
  - scripts/prototype-tracker.spec.mjs
  - scripts/doc-budgets.manifest.json
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m8-prototype-filter-refinement*
  - .agents/flow/issues/m8-assignee-multiselect-filter*
  - .agents/notes/implemented/feature/2026-11-03-assignee-multiselect-filter*
adr:
  - ../../notes/implemented/feature/2026-11-03-assignee-multiselect-filter.md
github:
  number: 62
  url: https://github.com/Shadow-Azure/ZTask/issues/62
```

## Background

The task management prototype currently offers only importance and keyword search, so users cannot quickly locate tasks by assignee. Assignees exist on both main tasks and subtasks, and the filter must distinguish the two matching scopes; otherwise main tasks are hidden incorrectly or unrelated subtasks leak into the result.

## Goals

- Add a multi-select assignee dropdown to the right of the importance filter and left of the search box, with member search, multi-select, and clear.
- When a main-task owner matches, keep the whole task and all of its subtasks even if other people own some subtasks.
- When only a subtask owner matches, keep the main task but show only the subtasks owned by that person, and note the filtering inside the card.
- Combine the assignee filter with importance and keyword search using an intersection.
- Retain before/after prototype screenshots for UI review.
- Update the task-management filter, list API, derived-index, and frontend implementation contracts in `plan/fullstack-design`.
- Implement the assignee filter in the admin task-list API and Vue UI, with server and frontend tests per the design contract.

## Implementation

- `plan/m1-01-ui-prototype/ztask-prototype.html`: assignee multi-select component, the `taskAssigneeMatch` pure helper, filtered subtask rendering, and filter note.
- Adjust one demo subtask owner so the prototype can demonstrate the "subtask owner is not the main-task owner" branch.
- `scripts/prototype-tracker.spec.mjs`: cover main-owner match, subtask-only match, no match, multi-select union, and filtered card rendering.
- `plan/m1-01-ui-prototype/review/`: add before/after comparisons and interaction screenshots.
- `plan/fullstack-design/`: add the feature semantics, `ownerIds` query parameter, server-side subtask pruning, and frontend interaction contract.
- `apps/server/`, `apps/web/`, `packages/shared/`: implement the `ownerIds` query, compact multi-select filter, URL deep link, and partial-subtask note; add API and view specs under `tests/`.

## Steps

1. Extract the pure assignee matching logic and add specification tests.
2. Implement the toolbar multi-select and wire it to the task list.
3. Adjust demo data and verify both matching scopes and combined filters in the browser.
4. Capture before/after screenshots and complete the flow entry and Agent Note.

## Dependencies and boundary

- Depends on: the m1 prototype baseline and m1 prototype refinement.
- Boundary: the static prototype, full-stack design, specification tests, and screenshots, plus the real `apps/web` page and server-side filtering implemented to the design contract.

## Independent verification

```sh
pnpm test:prototype
pnpm lint:docs
pnpm verify:flow
```

- Specification tests cover both assignee matching scopes and combined conditions.
- Manual browser checks: multi-select dropdown, main-owner match, subtask-owner-only match, combination with importance and search, and the empty-result message.

## Acceptance

- The toolbar assignee dropdown supports multiple members; selecting updates the task list immediately, and clearing restores all tasks.
- A main-owner match keeps every subtask; a subtask-owner-only match shows only the matching subtasks with an explanatory note.
- Assignee, importance, and search apply together, with a clear empty-result message.
- The full-stack design filter contract matches the prototype, and a Markdown change summary is produced.
- `pnpm test:prototype`, `pnpm lint:docs`, and `pnpm verify:flow` all pass.

## Non-goals

- Do not change task-tree counts, dashboard statistics, or member views.
