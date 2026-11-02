# Tracker read-only cards and task-tree experience

English | [中文](m3-tracker-experience.md)

```yaml flow
kind: issue
milestone: m3
priority: P1
status: done
scope:
  - apps/web/src/features/tracker/**
  - apps/web/src/features/tasks/**
  - apps/web/src/components/**
  - tests/tracker/**
  - apps/web/src/pages/TrackerPage.vue
  - .agents/flow/issues/m3-tracker-experience*
  - .agents/flow/milestones/m3-admin-task-workflow*
adr: []
github:
  number: 17
  url: https://github.com/Shadow-Azure/ZTask/issues/17
```

## Background

With task APIs complete, the prototype tree-and-board layout, unified read-only cards, and adjustable panes need real data while keeping viewing separate from editing.

## Goals

- Implement the folder tree, search/filtering, expand/collapse, task lists, and complete subtask summaries.
- Use unified read-only cards that show progress directly, with editing only through explicit dialog entry points.
- Implement adjustable panes, task/dashboard tab placeholders, empty states, and responsive layout.

## Design basis

- `plan/fullstack-design/`: 02 §3 and §8, 03 §5–9, 08 §3–4 and §8–9, and the prototype tracker page.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Drive server filtering and tree results with query parameters; cards must not use implicit inline editing.
- Reuse M2 components for cards, progress rings, overdue badges, and importance colors.
- Preserve interfaces for deleted/current state and later dashboard/history rendering on large lists.

## Steps

1. Write tree, filtering, and card interaction tests against API fixtures first.
2. Connect real queries, then complete pane resizing and editor entry points.
3. Review desktop/narrow-screen screenshots against the prototype and fix keyboard interactions.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run tracker component and browser tests for filtering, tree selection, card details, editor entry, pane dragging, and refresh recovery.

## Acceptance criteria

- Tree, list, cards, subtasks, and details remain consistent without duplicate nesting or stale caches.
- Unified cards contain no legacy inline editing and match the prototype.
- Keyboard and narrow-screen users can inspect tasks and open the editor.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not implement member access control, dashboard charts, or history diffs.
