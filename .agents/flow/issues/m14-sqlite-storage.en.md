# Replace per-aggregate file storage with a single SQLite database

English | [中文](m14-sqlite-storage.md)

```yaml flow
kind: issue
milestone: m14
priority: P1
status: in-progress
scope:
  - apps/server/**
  - apps/cli/**
  - apps/ztask/**
  - packages/shared/**
  - tests/**
  - plan/fullstack-design/**
  - .agents/**
  - .gitignore
  - .npmrc
  - .github/**
  - docs/**
  - reports/**
  - README.md
  - README.en.md
  - README.i18n.yaml
  - package.json
  - pnpm-lock.yaml
  - scripts/doc-budgets.manifest.json
  - scripts/package-smoke.mjs
  - scripts/verify-flow-online.mjs
  - scripts/verify-flow-online.spec.mjs
adr:
  - ../../notes/implemented/architecture/2026-11-05-sqlite-storage.md
github:
  number: 79
  url: https://github.com/Shadow-Azure/ZTask/issues/79
```

## Background

The current storage splits members, folders, task aggregates, history, share links, sessions, and network configuration into JSON/JSONL files; the application maintains atomic writes, JSONL tail recovery, current/revision-tip reconciliation, and startup index rebuilds itself. The user asked to move to SQLite and to review the design documents first.

## Goals

- Define and implement the `ztask.db` schema: normalized current state, full-snapshot history, and a transactional write protocol.
- One-time legacy import, legacy-backup compatibility, schema migration, `VACUUM INTO` backup/restore, and doctor validation.
- Keep the existing API DTOs, permissions, dashboard semantics, and history-diff behavior unchanged.

## Design basis

- `plan/fullstack-design/`: 01 §2/§6–§8, 04 §1/§5, 06 in full, 07 §1/§2/§9, 09.
- Agent Note: `../../notes/implemented/architecture/2026-11-05-sqlite-storage.md`.

## Implementation steps

1. After design approval, add the SQLite schema, connection/transaction wrapper, and repositories.
2. Move task aggregates, members, folders, share links, and network configuration onto the new write paths.
3. Implement legacy import, backup/restore/doctor, and consistency checks.
4. Replace storage tests and run the full gates.

## Dependencies and delivery boundary

- Prerequisite: design approval; this issue's ready status does not mean implementation has started.
- Stay within the scope above; widen the scope and explain before crossing it.
- Do not change UI or API contracts; see 06 §11 for the driver choice.
- The Node floor (Node 20.19–25; Node 22.x requires 22.12+) is maintained together with the SQLite driver, the published package `engines`, and the install docs.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:docs && pnpm verify:flow
```

Verify legacy import with real or synthetic data directories; cover abort before commit, migration failure, and backup/restore separately.

## Acceptance criteria

- After legacy import, tasks, history, members, links, sessions, network configuration, and revision checksums are complete.
- Transaction commit/rollback, version conflicts, WAL recovery, backup/restore, and doctor are tested.
- Existing API, permission, dashboard, and history behavior do not regress.

## Gates and CI

- Reference this issue's GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready/in-progress before starting.
- `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` are required; CI also checks PR diff scope and GitHub two-sided consistency.
- Update the same Agent Note for new architecture decisions; after implementation, archive it from proposed to implemented.

## Non-goals

- No separate database service, ORM, or multi-process shared database; no UI/API contract changes; no cross-machine sync.
