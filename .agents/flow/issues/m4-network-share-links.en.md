# Dynamic LAN listener and share-link lifecycle

English | [中文](m4-network-share-links.md)

```yaml flow
kind: issue
milestone: m4
priority: P0
status: backlog
scope:
  - apps/cli/**
  - apps/server/src/modules/network/**
  - apps/server/src/modules/shares/**
  - apps/web/src/features/members/**
  - packages/shared/**
  - tests/sharing/**
  - .agents/flow/issues/m4-network-share-links*
adr: []
github:
  number: null
  url: null
```

## Background

Member collaboration depends on distributable links and controlled network exposure. Enabling LAN must expose only the share domain, and rotation or revocation must invalidate old access immediately.

## Goals

- Implement dynamic listening on a specific LAN IP, shutdown, and shareBaseUrl in network.json.
- Implement high-entropy token generation, hashed storage, rotation, revocation, and controlled full-URL presentation.
- Reuse confirmation dialogs for network and link actions, explaining the impact on previously distributed links.

## Design basis

- `plan/fullstack-design/`: 01 §3–4, 05 §4.5–4.10, 07 §3, and 08 §5.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Use link state as the final access guard; residual session files must not bypass revocation.
- Do not rewrite tokens when addresses change; derive new URLs dynamically and require redistribution.
- Reject Admin APIs for every LAN request in one hook and close associated connections when the listener stops.

## Steps

1. Write network authorization, token hashing, and rotation/revocation tests first.
2. Implement network/share services and APIs, then connect admin actions.
3. Use two isolated browser contexts to verify old-link invalidation and address changes.

## Dependencies and delivery boundary

- Baseline: previous milestones in the roadmap; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run share contract and network integration tests. Request Admin APIs over loopback and LAN connections, then verify generation, rotation, revocation, and restart.

## Acceptance criteria

- Admin APIs cannot be reached without authorization in default or LAN mode.
- Tokens are not stored in plaintext, and old links/sessions fail after rotation or revocation.
- Share URLs follow shareBaseUrl, and the UI never claims it can recover an unrecoverable secret.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not expose public Internet access, add user accounts, or implement member-page business logic.
