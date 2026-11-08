# Tracker prototype autosave and admin-only context menu

English | [中文](m16-tracker-autosave-tree-permissions.md)

```yaml flow
kind: issue
milestone: m16
priority: P1
status: ready
scope:
  - plan/m1-01-ui-prototype/**
  - scripts/prototype-tracker.spec.mjs
  - .agents/flow/issues/m16-*
  - .agents/notes/proposed/feature/2026-11-08-tracker-autosave-context-menu*
  - apps/web/src/features/folders/**
  - apps/web/src/features/tracker/**
  - tests/admin-members/**
  - tests/tracker/**
adr:
  - ../../notes/proposed/feature/2026-11-08-tracker-autosave-context-menu.md
github:
  number: 91
  url: https://github.com/Shadow-Azure/ZTask/issues/91
```

## Background

The prototype currently saves only on explicit actions, and the left task tree has no management entry, so the product shape of "service-wide periodic change detection with autosave" and "admin right-click create/delete task" cannot be confirmed first.

## Goals

- Add a global autosave status to the tracker prototype: every 5 seconds detection, changes detected, and autosave complete.
- Connect task dialogs, member editing, and member-view progress to autosave; keep explicit creation actions for new tasks and members.
- Enable autosave by default and allow disabling it via `autosave.enabled=false` in `~/.ztask/settings.json` or `ztask autosave off`; disabling returns to manual saving.
- Let admins right-click a folder to create a task and right-click a task to create or delete it; add a read-only member-page tree for all team tasks with right-click, gray admin-only items, and per-option permission labels; keep the three member groups with collapsible headings.
- Keep before/after screenshots for confirmation.

## Implementation

- `plan/m1-01-ui-prototype/ztask-prototype.html`: top-bar autosave status and settings popover, autosave/manual modes in task and member dialogs, member-view progress autosave, context menus on the admin tree and member-page tree, and the three collapsible member groups.
- `apps/web` `FolderTree` / `FolderTreeNode` / `TrackerView`: both admin and member tracker trees support right-click; admin actions are enabled, while member-side admin-only items are grayed with per-row "Admins only" labels; new task, new subtask folder, and delete reuse the existing editor and confirmation dialog.
- `tests/admin-members` and `tests/tracker`: tree-node context-menu events, enabled admin menu, and disabled member menu.
- `scripts/prototype-tracker.spec.mjs`: autosave copy and off state, task draft validation, member tree filtering, option-level permissions, and menu positioning.
- `plan/m1-01-ui-prototype/review/`: before/after screenshots for permission labels, the member tree, and autosave configuration.
- This delivery changes only the static prototype; real frontend, `~/.ztask/settings.json` read/write, and the `ztask` command wait for prototype confirmation.

## Independent verification

```sh
pnpm test:prototype
pnpm lint:docs
pnpm verify:docs
pnpm verify:flow
```

- Specification tests cover autosave states, draft validation, admin/member menu differences, and viewport-edge menu positioning.
- Browser verification covers folder/task right-click, autosave detection and completion, and the member view without a task tree.

## Non-goals

- Do not implement real `apps/web`, `~/.ztask/settings.json` read/write, the `ztask` command, or server-side autosave.
- Do not change the task data protocol, member permission matrix, or member-view visibility scope.
