# Screen-by-screen UI parity and a clean difference ledger

English | [中文](m6-ui-parity.md)

```yaml flow
kind: issue
milestone: m6
priority: P2
status: done
scope:
  - apps/web/**
  - apps/server/**
  - packages/**
  - tests/**
  - .agents/flow/**
  - .agents/notes/**
  - scripts/doc-budgets.manifest.json
adr: []
github:
  number: 55
  url: https://github.com/Shadow-Azure/ZTask/issues/55
```

## Background

`plan/m1-01-ui-prototype/ztask-prototype.html` is the approved UI baseline; the shipped web app diverges from it in layout, styling, copy, and interaction details across many screens, so the gap must be closed screen by screen.

## Goals

- Compare the admin and member surfaces against the prototype as the single baseline, produce an actionable difference list, and fix it.
- Match the prototype on key interactions, empty states, and boundary states; drive differences to zero or record rulings with reasons.
- Sync the affected DTOs and unit tests, and keep local and CI gates green.

## Design basis

- `plan/m1-01-ui-prototype/ztask-prototype.html`: UI and interaction baseline.
- `plan/fullstack-design/`: page boundaries, data contracts, and permission rules.

## Implementation

- Screen-by-screen alignment on both surfaces: appbar, folder tree, task cards, dashboard, changes panel, members page, and share-link cell.
- `TaskChange` gains an importance field for the leading dot in the changes list.
- Unit tests follow the new DOM structure, copy, and redacted presentation.

## Steps

1. A comparison subagent captures evidence per screen and writes the difference list.
2. A fix subagent repairs each item; the next round confirms the result.
3. Once every difference is closed, commit and pass CI.

## Dependencies and delivery boundary

- Prerequisite: every earlier milestone in the roadmap is complete; this issue delivers only parity plus the necessary sync.
- Code changes stay within scope; add no features beyond the prototype.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:docs && pnpm verify:flow
```

Open the key admin and member pages at 1440×900 and compare them screen by screen with the prototype.

## Acceptance criteria

- No actionable difference remains after the screen-by-screen comparison (every retained difference carries a ruling and reason).
- Unit tests, builds, docs, and CI gates are green.

## Gates and CI

- The PR title and the branch's commit titles reference this issue's GitHub `(#N)`.
- Required: `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow`; CI additionally runs the PR diff scope and remote consistency checks.

## Non-goals

- No new visuals or features beyond the prototype; never widen security boundaries to gain parity.
