# Task List Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Present every task's subtask completion and full progress details in a unified read-only card, with editing confined to the modal.

**Architecture:** Keep the current single-file prototype and table columns. Use one outer container per task, a clear header, and a two-column read-only body. Remove expansion state and all inline editing controls; retain the existing modal for editing.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node test runner, Playwright for visual verification.

**Spec:** User request in the current task; baseline prototype at `plan/m1-01-ui-prototype/ztask-prototype.html`.

## Global Constraints

- Do not change task data shape, editing behavior, table semantics, or other prototype pages.
- Show all subtask and progress content directly without nested cards or disclosure controls.
- Remove quick-progress and row actions; preserve filtering, search, and keyboard access to the edit modal.

## Review Focus

- Empty subtasks/details must produce useful empty states rather than broken markup; covered by summary renderer tests.
- Read-only content must contain no buttons, inputs, or inline editing affordances; covered by browser interaction verification.
- Progress bars must remain visible after replacing table styles; covered by visual verification.

---

### Task 1: Unified read-only card behavior

**Files:**
- Modify: `scripts/prototype-tracker.spec.mjs`
- Modify: `plan/m1-01-ui-prototype/ztask-prototype.html`

**Interfaces:**
- Produces: `subtaskSummary(subs)` returning `{ done, total }`.
- Produces: `taskRow(t, isSub, fromFolder)` with read-only card markup.

- [x] Write failing tests for completed/total counts, empty subtasks, summary labels, detail line preservation, and absence of inline editing controls.
- [x] Run `pnpm test:prototype` and confirm the new tests fail for missing behavior.
- [x] Implement a unified card with direct subtask and full-detail rendering.
- [x] Run `pnpm test:prototype` and confirm all tests pass.

### Task 2: Unified card visual design

**Files:**
- Modify: `plan/m1-01-ui-prototype/ztask-prototype.html`

**Interfaces:**
- Consumes: `subtaskSummary(subs)` and `taskRow(t, isSub, fromFolder)`.

- [x] Add one header and one two-column body per task without nested cards.
- [x] Add compact status/progress styling, empty states, responsive behavior, and clear selected/expanded treatment.
- [x] Verify read-only content, modal opening, progress bars, filtering, and keyboard activation in Chrome.
- [x] Run `pnpm test:prototype` and `pnpm lint:docs`.

### Task 3: Visual review and decision record

**Files:**
- Create: `plan/m1-01-ui-prototype/review/*.png`
- Create: `.agents/notes/implemented/feature/2026-11-01-task-list-overview.{md,en.md,i18n.yaml}`

- [x] Capture matching before/after crops for summary, expanded subtasks, and complete progress detail.
- [x] Inspect full-page and narrow-width screenshots; correct any clipping or visual imbalance.
- [x] Record the design decision bilingually and refresh i18n hashes.
- [x] Run final prototype tests and documentation gates; inspect the final diff.
