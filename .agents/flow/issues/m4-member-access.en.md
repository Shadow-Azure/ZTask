# Member sessions, data isolation, and read-only tracker

English | [中文](m4-member-access.md)

```yaml flow
kind: issue
milestone: m4
priority: P0
status: in-progress
scope:
  - apps/server/src/modules/share/**
  - apps/server/src/plugins/auth*
  - apps/web/src/features/share/**
  - apps/web/src/features/tracker/**
  - packages/shared/**
  - tests/member-access/**
  - apps/server/src/app.ts
  - apps/web/src/pages/ShareSessionPage.vue
  - apps/web/src/pages/MemberHomePage.vue
  - apps/web/src/layouts/ShareLayout.vue
  - apps/web/src/api/share.ts
  - .agents/flow/issues/m4-member-access*
adr: []
github:
  number: 18
  url: https://github.com/Shadow-Azure/ZTask/issues/18
```

## Background

A share link is only a credential. The actual security boundary is session exchange, per-request link validation, and memberId-scoped queries; hiding UI cannot replace server authorization.

## Goals

- Implement fragment-token exchange for an HttpOnly Cookie, session restore/logout, and a common invalid-link page.
- Return only owner/collaborator-related tasks, details, and trees to members.
- Reuse the tracker as a fully read-only experience, with no member administration in the member shell.

## Design basis

- `plan/fullstack-design/`: 01 §4–5, 02 §4–6, 05 §6.1–6.5 and §6.11, 07 §3, and 08 §6–7.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Clear the fragment with replace after exchange; keep tokens out of query caches, logs, and referrers.
- Construct member scope centrally on the server so deep links and direct APIs are equally restricted.
- Clear share query caches on logout/invalidation so browser Back cannot reveal old private content.

## Steps

1. Write A/B member isolation, session recovery, and invalidation tests first.
2. Implement session and read-only APIs, then connect ShareLayout and tracker access=readonly.
3. Verify missing tokens, revoked tokens, cross-member task IDs, and admin deep links.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run the permission matrix and end-to-end tests in isolated A/B browser contexts, directly requesting the other member’s tasks, full trees, and Admin APIs.

## Acceptance criteria

- A cannot obtain B’s private data through UI, deep links, or APIs.
- The tracker renders and registers no writes, including after refresh/session restoration.
- Sensitive tokens never appear in persistent caches, logs, or subsequent referrers.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not add member registration, passwords, member administration, or cross-member chat.
