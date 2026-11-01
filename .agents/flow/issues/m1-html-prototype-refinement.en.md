# Prototype refinement wrap-up and review artifact governance

English | [中文](m1-html-prototype-refinement.md)

```yaml flow
kind: issue
id: m1-03
milestone: m1
depends:
  - m1-01
priority: P0
status: in-progress
scope:
  - plan/m1-01-ui-prototype/**
  - .gitignore
  - package.json
  - scripts/prototype-tracker.spec.mjs
  - .agents/notes/implemented/feature/2026-11-01-*
  - .agents/flow/issues/m1-html-prototype-refinement*
adr: []
github:
  number: 8
  url: https://github.com/Shadow-Azure/ZTask/issues/8
```

## Background

The interface refinements produced during the m1-01 review wrap-up (tracker tree progress and resizing, read-only task progress cards, dashboard time-range and disclosure controls) plus the review-artifact governance stayed on a branch and never landed; m1-01 was closed on prototype sign-off, so this wrap-up batch needs its own flow ownership to pass the flow gates and reach main.

## Goals

- Land the three interface refinements from the prototype review wrap-up, consistent with the screen-by-screen conclusions.
- Add an offline-runnable spec for the prototype tracker structures, wired into `pnpm test:prototype`.
- Govern local review artifacts: the walkthrough report and the PDF export directory stay unversioned.

## Design authority

- The signed-off static prototype `plan/m1-01-ui-prototype/ztask-prototype.html` and the screen-by-screen review conclusions from m1-01.
- The review alignment notes with the user (local review artifacts, unversioned by governance).

## Implementation

- The three control refinements in `plan/m1-01-ui-prototype/ztask-prototype.html`.
- The `scripts/prototype-tracker.spec.mjs` spec and the `test:prototype` script in `package.json`.
- Three Agent Notes (the `.agents/notes/implemented/feature/2026-11-01-*` triplets) recording the implementation decisions behind the three refinements.
- Two ignore entries in `.gitignore` for the local walkthrough report and the PDF export directory.

## Implementation steps

1. Refine tracker tree progress and resizing, with a matching spec.
2. Refine the read-only task progress cards, keeping before/after review screenshots.
3. Add dashboard time-range and disclosure controls, with a matching spec.
4. Ignore the local review report and PDF export directory; create this issue and land the batch under the flow gates.

## Dependencies and boundary

- Dependencies: m1-01 (prototype sign-off and review).
- Delivery boundary: prototype refinements, specs, and ignore rules; no real front-end or back-end implementation.

## Verification

```sh
pnpm test:prototype && pnpm verify:docs && node scripts/verify-flow.mjs --diff origin/main
```

- All three commands are green; the spec covers tracker tree progress, read-only cards, and dashboard control behavior.

## Acceptance

- The three control groups work on the prototype page and behave as concluded in the review.
- `pnpm test:prototype` is fully green.
- Both CI lanes, build-and-docs and flow-online, are green.

## Gates and CI

- Changes to the prototype, specs, `.gitignore`, and this issue triplet all fall inside this issue's scope union.
- The CI build-and-docs lane (including `verify-flow --diff`) and flow-online (milestone association check) are the online acceptance.

## Non-goals

- No real front-end or back-end implementation.
- No moving the local review screenshots and reports back into version control.
