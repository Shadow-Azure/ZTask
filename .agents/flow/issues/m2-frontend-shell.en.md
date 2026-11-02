# Vue application shell and prototype design-system migration

English | [中文](m2-frontend-shell.md)

```yaml flow
kind: issue
milestone: m2
priority: P1
status: in-progress
scope:
  - apps/web/**
  - packages/shared/**
  - tests/web-shell/**
  - package.json
  - pnpm-lock.yaml
  - vitest.config.ts
  - .agents/flow/issues/m2-frontend-shell*
adr: []
github:
  number: 14
  url: https://github.com/Shadow-Azure/ZTask/issues/14
```

## Background

Admin and member pages will share layout, cards, dialogs, and query behavior. Migrating tokens and shells first prevents each page from copying prototype CSS.

## Goals

- Set up Vue Router, TanStack Query, admin/member layouts, and route access modes.
- Migrate colors, spacing, typography, task cards, progress rings, dialogs, toasts, resizable panes, and responsive rules.
- Encapsulate requests, errors, 15-second polling, and focus refresh; keep private data out of localStorage.

## Design basis

- `plan/fullstack-design/`: 03 §1–4 and §8–9, 08 §1–2 and §8, and all prototype pages.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Define admin and share route placeholders; ShareLayout contains only member home and tracker navigation.
- Split prototype markup into reusable presentational components without a UI suite that changes the visual design.
- Add baseline tests for keyboard focus, 200% text zoom, narrow screens, and read-only mode.

## Steps

1. Establish prototype screenshot baselines and the component inventory first.
2. Implement design tokens, shells, and the request layer, then migrate shared presentational components.
3. Connect routing and query policies, then review desktop, narrow-screen, and keyboard behavior.

## Dependencies and delivery boundary

- Baseline: the M1 prototype and design; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run component tests and the production build; compare screenshots at 1280/1440 and prototype narrow widths. Check navigation, focus, polling pause, and cache cleanup.

## Acceptance criteria

- Every prototype route has an explicit placeholder without unauthorized business navigation.
- Shared components and tokens can be reused directly by task, dashboard, and member pages.
- Empty, error, and loading states work, and narrow screens lose no critical content.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not connect real task data or implement edit mutations, share exchange, or dashboard metrics.
