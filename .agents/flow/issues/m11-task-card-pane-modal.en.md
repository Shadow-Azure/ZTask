# Open the task modal when clicking subtask progress or progress detail

English | [中文](m11-task-card-pane-modal.md)

```yaml flow
kind: issue
milestone: m11
priority: P1
status: in-progress
scope:
  - apps/web/**
  - tests/**
  - plan/**
  - .agents/**
  - reports/**
  - scripts/prototype-tracker.spec.mjs
  - scripts/doc-budgets.manifest.json
adr: []
github:
  number: 71
  url: https://github.com/Shadow-Azure/ZTask/issues/71
```

## Background

On 2026-11-04 a user reported that clicking "subtask progress" or "progress detail" on the task management page never opens a modal, although one is expected. Real-build and real-API smoke reproduced it: clicking the card header opens the edit modal (`[role="dialog"]` count 1), while clicking either content pane leaves the count at 0 with no browser console error.

The root cause is that `TaskCard` binds `open` only on `.card-head`; the two `section.pane` content regions have no click or keyboard entry, and the list hint still says "click the task title area". The card already shows subtasks and full progress outside the header, so users naturally treat the content area as part of the same card entry.

## Goals

- Make "subtask progress" and "progress detail" open the task modal like the header: the admin edit modal and the member read-only detail modal.
- Make click and Enter/Space equivalent, give the panes button semantics, tabindex, and an opening hint, and add no editing controls.
- Do not trigger the modal when dragging to select text inside a pane; keep separator dragging and width adjustment unchanged.
- Keep the prototype and list hint copy in sync; add UT/IT guards that fail before the fix and pass after it.
- Cover the same scenario before and after the fix with real-build and real-API smoke screenshots, and put the report content and screenshots in the PR description.

## Acceptance

- In the admin view, clicking either "subtask progress" or "progress detail" opens the task edit modal; after closing, clicking the other pane still opens it.
- The member read-only view opens the read-only detail modal from either pane and requests no `/api/v1/admin/**`.
- Enter/Space on a pane opens it; dragging the separator does not; dragging to select text does not.
- The new regression tests fail before the fix and pass after it; `pnpm test`, `pnpm lint:docs`, and `pnpm verify:flow` pass.
- The smoke report records before/after screenshots and the no-console-error conclusion; the report and screenshots are delivered locally and in the PR description only, not committed to the remote repository.
