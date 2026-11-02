# Backup recovery, fault injection, and first-release acceptance

English | [中文](m5-recovery-acceptance.md)

```yaml flow
kind: issue
milestone: m5
priority: P0
status: done
scope:
  - apps/cli/**
  - apps/server/src/modules/maintenance/**
  - apps/server/src/storage/**
  - docs/**
  - tests/e2e/**
  - tests/recovery/**
  - tests/storage/**
  - .agents/notes/implemented/feature/2026-11-02-*
  - packages/shared/**
  - plan/fullstack-design/05-api-design.md
  - apps/server/src/index.ts
  - apps/server/src/app.ts
  - package.json
  - .agents/flow/issues/m5-recovery-acceptance*
adr: []
github:
  number: 23
  url: https://github.com/Shadow-Azure/ZTask/issues/23
```

## Background

Before release, the file protocol must prove recoverability under real failures and complete workflows, with actionable documentation for startup, backup, and access boundaries.

## Goals

- Implement online backup with a paused write queue and restoration validation in a new directory.
- Complete end-to-end tests for startup, sharing, administration, member collaboration, dashboard history, and concurrent conflicts.
- Document fault injection, backup recovery, access isolation, desktop/narrow-screen behavior, and accessibility acceptance.

## Design basis

- `plan/fullstack-design/`: 01 §6–10, 04 §9–10, 06 §8–10, and 09 §3 and §6.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Wait for in-flight writes, then validate the manifest, JSON/JSONL, checksums, and references in a temporary directory before publishing a backup.
- Provide repeatable seed data and fault points without using real private data directories in tests.
- Update durable architecture/development documents and Agent Notes so implementation preserves confirmed boundaries.

## Steps

1. Specify backup/recovery tests and the full acceptance matrix first.
2. Add fault injection and end-to-end automation, fixing discovered issues.
3. Restore into a clean directory and run two-member browser acceptance, then synchronize documents.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run all unit, integration, fault-injection, and end-to-end gates. Start from an online backup in a new data directory and rerun A/B permissions and main flows.

## Acceptance criteria

- Backups contain no mixed-time state, and restored data, history, session policy, and indexes agree.
- All ten acceptance scenarios in 09 §6 have results, with zero severe permission or data-loss defects.
- A new user can start, back up, and restore from the documentation, with all CI and document gates passing.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not promise public high availability, multiple writers, multi-device sync, plugins, or features explicitly excluded from the first release.
