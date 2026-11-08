# Whole-team member visibility with owner-only writes

English | [中文](m15-member-task-visibility.md)

```yaml flow
kind: issue
milestone: m15
priority: P0
status: ready
scope:
  - apps/server/src/modules/share/**
  - scripts/doc-budgets.manifest.json
  - scripts/prototype-tracker.spec.mjs
  - apps/server/src/modules/dashboard/**
  - apps/server/src/modules/revisions/**
  - apps/web/**
  - packages/shared/**
  - tests/**
  - plan/fullstack-design/**
  - plan/m1-01-ui-prototype/**
  - .agents/notes/implemented/feature/2026-11-08-share-all-task-visibility*
  - .agents/notes/implemented/feature/2026-11-02-member-owner-write-boundary*
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m15-*
  - .agents/flow/issues/m15-*
adr:
  - ../../notes/implemented/feature/2026-11-08-share-all-task-visibility.md
  - ../../notes/implemented/feature/2026-11-02-member-owner-write-boundary.md
github:
  number: 97
  url: https://github.com/Shadow-Azure/ZTask/issues/97
```

## Background

Member links used to return only tasks where the member was an owner or collaborator; the home page had two groups, and the tracker, dashboard and history applied the same scope. The user confirmed that members may view every team task, only the main-task owner may edit their own progress, detail and subtasks, and the home page shows three groups expanded by default with collapsible headings. Code, prototype and design docs must move to this rule.

## Goal

- `GET /share/tasks?view=home` returns owned/collaborated/others; tracker, folder tree, dashboard and history return the whole team.
- Member detail DTOs keep the full detail and every non-deleted subtask; `memberRole` adds viewer; a non-owner write returns 403.
- The member home shows three groups, expanded by default, with collapsible headings; other-member cards are marked read-only.
- The tracker stays fully read-only; owner editing remains on the home page.
- Update design docs, the Agent Note, the prototype and tests.

## Design basis

- `plan/fullstack-design/02-features.md` §4–5, `05-api-design.md` §6, `07-backend-implementation.md` §5.1 and `08-frontend-implementation.md` §6.
- `plan/m1-01-ui-prototype/ztask-prototype.html` and the user-confirmed three-group/collapse screenshots.
- The `2026-11-08-share-all-task-visibility` Agent Note.

## Implementation steps

1. Adjust the share scope, routes, DTOs and write checks; delete the dashboard/history member-scope branches.
2. Add the others group, read-only labels and three-group collapse to the member home; update tracker copy and role labels.
3. Update server, web and e2e tests plus the full-stack design docs.
4. Keep before/after real-app screenshots and run the full gates.

## Verification

```sh
pnpm test
pnpm lint:docs
pnpm verify:docs
pnpm verify:flow
```

## Acceptance criteria

- Home groups partition all tasks; tracker/tree/dashboard/history cover the whole team.
- Non-owner writes return 403; nonexistent/soft-deleted tasks and subtask ids return 404; owner writes still use version and revision protocols.
- Home groups are expanded by default and collapsible; other members are read-only; the tracker has no write controls.
- Docs, prototype, tests and implementation agree.

## Non-goals

- Per-task privacy, accounts, exposing member management, or cross-session collapse persistence.
