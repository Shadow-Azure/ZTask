# Deleted Task History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close the backend design gaps found in the API/storage review and make deleted tasks visible at the bottom of prototype history results with an explicit current-deleted badge.

**Architecture:** Keep the aggregate JSON + JSONL design, but type assignments by taskId, return nullable revision metadata for no-op writes, and use a `[start,end)` history window with a deleted-inclusive candidate set. In the static prototype, separate active task scope from history scope and sort currently deleted changes last.

**Tech Stack:** Markdown design documents, HTML, CSS, vanilla JavaScript, Node test runner, browser visual verification.

**Spec:** `plan/fullstack-design/05-api-design.md`, `06-database-design.md`, `07-backend-implementation.md`, and the user's deleted-task display requirement.

## Global Constraints

- Do not change the confirmed member page model, dynamic LAN listeners, or aggregate file recovery protocol.
- Current-deleted tasks stay out of active trees, lists, counts, and current dashboard buckets.
- History includes deleted tasks, marks them as currently deleted, and places them after non-deleted changes.
- Follow TDD for prototype behavior and preserve existing prototype tests.

## Review Focus

- Subtask ownership must coexist with main-task ownership through `(taskId,memberId)` assignments.
- No-op writes return `revision=null`, not a fabricated snapshot.
- Changes exactly at start are included; deleted candidates are not dropped by active indexes.
- Created-then-deleted tasks use deleted as the primary change kind.

---

### Task 1: Close backend design contracts

**Files:**
- Modify: `plan/fullstack-design/05-api-design.md`
- Modify: `plan/fullstack-design/06-database-design.md`
- Modify: `plan/fullstack-design/07-backend-implementation.md`
- Modify: `plan/fullstack-design/09-review-guide.md`

- [x] Define typed assignments, subtask DTO/version behavior, nullable revision results, and missing service methods.
- [x] Specify `[start,end)`, deleted-inclusive history scope, current-related permission scope, and created/deleted precedence.
- [x] Add `currentlyDeleted` to history responses and require deleted-last frontend presentation.
- [x] Specify stable pagination, required dueDate, archive/index coordination, and listener close semantics.

### Task 2: Add failing prototype tests

**Files:**
- Modify: `scripts/prototype-tracker.spec.mjs`

- [x] Add tests for active/history scope separation, start-inclusive comparisons, created/deleted change kinds, current-deleted badges, and deleted-last ordering.
- [x] Run `pnpm test:prototype` and confirm the new tests fail for the intended reasons.

### Task 3: Implement prototype behavior

**Files:**
- Modify: `plan/m1-01-ui-prototype/ztask-prototype.html`

- [x] Add a deleted task fixture with a delete revision while keeping it out of active views.
- [x] Implement `[start,end)` history comparisons, created/deleted handling, badge rendering, and deleted-last sorting.
- [x] Run `pnpm test:prototype` and confirm all tests pass.

### Task 4: Visual review and decision record

**Files:**
- Create: `plan/m1-01-ui-prototype/review/*deleted*.png`
- Create: `.agents/notes/implemented/feature/2026-11-01-deleted-task-history.{md,en.md,i18n.yaml}`

- [x] Capture matching before/after dashboard history screenshots with a currently deleted task last.
- [x] Inspect desktop and narrow rendering, then record the decision bilingually and refresh i18n hashes.
- [x] Run `pnpm test:prototype`, `pnpm lint:docs`, and `pnpm verify:docs`; inspect the final diff.
