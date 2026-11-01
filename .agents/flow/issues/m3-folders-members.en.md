# Folder and member-record management

English | [中文](m3-folders-members.md)

```yaml flow
kind: issue
milestone: m3
priority: P0
status: backlog
scope:
  - apps/server/src/modules/folders/**
  - apps/server/src/modules/members/**
  - apps/web/src/features/folders/**
  - apps/web/src/features/members/**
  - packages/shared/**
  - tests/admin-members/**
  - .agents/flow/issues/m3-folders-members*
adr: []
github:
  number: null
  url: null
```

## Background

Tasks reference folders, owners, and collaborators, so stable management must come first. Member archival must remain separate from share-link lifecycle.

## Goals

- Implement nested-folder CRUD, tree ordering, and deletion constraints.
- Implement member creation, renaming, role information, archival, and queries without rewriting task aggregates on archive.
- Complete the prototype member table and confirmation dialogs with persistent state after refresh.

## Design basis

- `plan/fullstack-design/`: 02 §3, 05 §3.1–3.3 and §4.1–4.4, 06 §4, and 08 §3.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Validate parents, cycles, non-empty names, and member references on the server; exclude archived members from active indexes and assignment controls.
- Provide folder-tree operations and member dialogs in the frontend, with impact explanations for dangerous actions.
- Do not generate or display copyable share links in this stage.

## Steps

1. Write hierarchy and archival contract tests first.
2. Implement server routes and storage transactions, then connect admin components.
3. Cover deleting populated folders, archiving assigned members, and refresh recovery.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run folder/member API contract tests and browser admin flows; restart and inspect trees, member state, and task references.

## Acceptance criteria

- Invalid hierarchies, deletion constraints, and archival return the designed errors.
- Historical tasks of archived members remain readable, and new assignments cannot select them.
- Desktop and narrow-screen member management matches the prototype.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not implement tokens, network configuration, member pages, or the task editor.
