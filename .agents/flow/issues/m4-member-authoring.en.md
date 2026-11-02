# Member-home owner authoring and collaborator read-only behavior

English | [中文](m4-member-authoring.md)

```yaml flow
kind: issue
milestone: m4
priority: P1
status: in-progress
scope:
  - apps/server/src/modules/share/**
  - apps/web/src/features/share/**
  - apps/web/src/features/tasks/**
  - apps/web/src/pages/MemberHomePage.vue
  - packages/shared/**
  - tests/member-authoring/**
  - tests/member-access/**
  - apps/web/src/api/share.ts
  - .agents/notes/implemented/feature/2026-11-02-*
  - .agents/flow/issues/m4-member-authoring*
adr: []
github:
  number: 19
  url: https://github.com/Shadow-Azure/ZTask/issues/19
```

## Background

Member home lets owners update execution work with substantially fewer rights than admins. This requires minimal writes on the same aggregate while collaborators and the tracker remain read-only.

## Goals

- Separate “Owned by me” and “Collaborating” task cards on member home.
- Owners can save root-task progress and full details and create/edit/delete one-level subtasks.
- Collaborators remain read-only, and no member can edit assignments or create root tasks.

## Design basis

- `plan/fullstack-design/`: 02 §4–5, 05 §6.6–6.10, 07 §3, and 08 §6.2 and §9.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Every write endpoint validates session member, link state, owner relationship, and parent aggregate version.
- Member-created subtasks default to the current member as owner; root description, importance, folder, and root deletion remain unavailable.
- Preserve progress, detail, and subtask drafts on 409; refresh admin/member queries after success.

## Steps

1. Write the owner/collaborator/cross-member permission matrix first.
2. Implement constrained APIs and member-home mutations, then conflict-draft behavior.
3. Verify that direct write calls from collaborators cannot change data.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run member-write API and member-home browser tests for owner success, collaborator rejection, 409, subtask soft deletion, and historical snapshots.

## Acceptance criteria

- All three owner writes persist with correct revisions, while collaborator writes are rejected.
- Admin-only controls never appear, and the tracker remains fully read-only.
- Concurrent conflicts preserve drafts, and refresh restores correct role groups and data.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Members cannot modify root assignments, folders, importance, due dates, or delete root tasks.
