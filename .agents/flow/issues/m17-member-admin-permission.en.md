# Member administrator permission and admin-page access

English | [中文](m17-member-admin-permission.md)

```yaml flow
kind: issue
milestone: m17
priority: P2
status: in-progress
scope:
  - apps/server/src/app.ts
  - apps/server/src/bootstrap.ts
  - apps/server/src/modules/members/**
  - apps/server/src/modules/share/**
  - apps/server/src/storage/**
  - apps/web/src/**
  - packages/shared/**
  - tests/**
  - docs/architecture*
  - plan/fullstack-design/**
  - .agents/notes/implemented/feature/2026-11-09-member-admin-access*
  - .agents/notes/implemented/process/2026-11-01-engineering-flow-tree*
  - .agents/flow/**
  - scripts/doc-budgets.manifest.json
  - scripts/verify-flow-online.mjs
  - scripts/verify-flow-online.spec.mjs
adr:
  - ../../notes/implemented/feature/2026-11-09-member-admin-access.md
github:
  number: 105
  url: https://github.com/Shadow-Azure/ZTask/issues/105
```

## Background

The current permission model has only two tiers — local administrator and LAN member: the Admin API requires a loopback listener, a loopback remote address and a trusted Host, and member share links open only the home page and the read-only tracker. The user needs to mark a member as an administrator and have that member's share link enter the admin page. That requires an administrator capability flag on the member record and an explicit authorization boundary for the Admin API over LAN.

## Goals

- Add an administrator flag to member records, grant/revoke it in the member editor, and show the state in the list.
- After token exchange, an administrator member's share link enters the `/#/tracker` admin page; a normal member still enters `/#/s/home`.
- The Admin API on the LAN listener stays closed by default and opens only to valid member sessions with `isAdmin=true`; every request re-reads the member row, so revoking the flag, archiving the member, or rotating/revoking the link takes effect immediately.
- The admin shell restores the session on LAN and gates on administrator permission; normal members and missing sessions get explicit pages.
- Upgrade the database with an appended migration; existing databases and legacy imports keep members non-admin.
- Sync the design documents, Agent Note, tests and real UI before/after captures.

## Implementation steps

1. Extend the shared DTOs, member storage and v2 migration; add member create/update/list tests.
2. Extend the share session, cookie and Admin guard; add tests for LAN allow, normal-member denial, and immediate revocation.
3. Wire the member editor/list UI, administrator-link landing and admin-shell entry gate; add frontend tests.
4. Update the design documents and Agent Note, build the real application and capture before/after screenshots.
5. Run `pnpm test`, `pnpm build`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow`.

## Acceptance

- An administrator can mark a member as administrator, and the member list shows the state.
- An administrator member's share link enters the admin page and can call the Admin API to complete an admin operation; normal members and missing sessions still get 403/explicit notices on LAN.
- After revoking the administrator flag, archiving the member, or resetting/revoking the link, the old session can no longer call the Admin API.
- Existing databases upgrade to schema v2 automatically without losing data or task history.
- Permission, session, UI and document tests pass, with before/after captures of the same scenario.

## Non-goals

- No member registration, password login, or separate administrator account system.
- No intermediate tiers such as read-only administrator or task administrator.
- No administrator token in the URL or persistent frontend storage.
