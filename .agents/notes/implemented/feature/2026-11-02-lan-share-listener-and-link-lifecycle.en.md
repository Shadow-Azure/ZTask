# Agent Note: LAN Share Listener Lifecycle and Link Credential Boundary

Status: implemented

English | [中文](2026-11-02-lan-share-listener-and-link-lifecycle.md)

## Problem

Member collaboration requires "one process, two listeners": loopback serves administrators only, while a concrete LAN IP exposes only the member share surface; both must share one Store/Service/write queue and must not become two ZTask instances. The [fullstack design](../../../../plan/fullstack-design/01-architecture.md) 01 §3 and [04](../../../../plan/fullstack-design/04-backend-architecture.md) §4.1/§9 fix the start/stop ordering and permission principles, and [05](../../../../plan/fullstack-design/05-api-design.md) §4.5–4.9 fix the link and network endpoints, but they do not decide how runtime state maps to `network.json`, whether a share URL may be shown while the listener is down, whether the link secret is recoverable, or how rotation invalidates old sessions. These boundaries decide whether members ever receive unreachable or already-invalid addresses, so they are settled here.

## Decision

- **Two Fastify instances, one Store/Service**: `buildApp` creates separate loopback and LAN instances per `listenerKind`, sharing the `ZtaskStore` and the network/link services; the Admin local-only guard (listenerKind=loopback and loopback peer) rejects `/api/v1/admin/*` on the LAN instance. A single instance with two addresses is rejected because `listenerKind` is an instance-level decoration.
- **Configuration and runtime state are separate**: `network.json` stores only the desired configuration (enabled/host/port/shareBaseUrl); running/degraded/error live in `NetworkService`. `shareBaseUrl` is emitted only while running and must be null when degraded/offline, so no apparently usable address is distributed.
- **Start/stop ordering**: enabling or switching binds the new LAN entry first, atomically writes the config, then closes the old entry; a failed write closes only the new entry and keeps the old one. Disabling writes `enabled=false` first and keeps running if that write fails, without revoking tokens. Restart guarantees loopback first, then restores LAN from `network.json`; a failed restore is marked degraded and does not affect administration.
- **Hash-only links**: `share-links/<memberId>.json` stores only the token's SHA-256; the full URL appears once in the `generate`/`rotate` response and afterwards only a reset can reproduce it. Raw tokens are never written into member or link files just to make them re-copyable.
- **Invalidation chain for rotate/revoke/archive**: `rotate` atomically replaces the file with a new id/tokenHash and deletes all `auth-sessions` of that member; `revoke` idempotently writes revoked and deletes sessions; archiving a member revokes the link before writing `archivedAt`. The per-request link-status check remains the real guarantee; deleting sessions is cleanup.
- **URLs derive only from shareBaseUrl**: token files never embed full URLs; switching LAN addresses only updates `network.json` while tokens stay stable, and previously distributed URLs must be re-sent by the administrator (CLI `--lan` only restores on startup).

## Alternatives considered

- One Fastify instance listening on both addresses: `listenerKind` is an instance-level decoration, so admin/member traffic cannot be distinguished per connection — rejected.
- Embedding `shareBaseUrl` into every share-link file: changing IP would rewrite every token file and couple tokens to network config — rejected.
- Persisting raw tokens so old links stay copyable: writes long-lived credentials to disk and widens the leak surface — rejected; after a refresh the page only offers "rotate and show again".
- Keeping old session files on rotate and relying on linkId validation: works functionally but accumulates dead files and audit noise; rotate/revoke are rare operations, so deleting that member's sessions is cleaner.
- Marking links revoked when sharing is disabled: would break "old links keep working after re-enabling", violating 01 §3.1/§3.2 — rejected.

## Consequences

- `ServeHandle` exposes the network/shareLink services for routes, the CLI, and tests; a failed LAN restore is a **degradation**, not a startup failure, and health checks stay available.
- The share URL is copyable only in the controlled result area right after generate/rotate; after a page refresh an administrator must rotate to obtain a new URL — the unavoidable cost of hash-only.
- Session cleanup now covers rotate/revoke/archive; periodic cleanup of expired sessions remains follow-up debt (recorded in the #18 note).
- Multi-process/reverse-proxy setups are out of scope for v1; rate-limit thresholds for NAT-shared egress IPs must be re-evaluated before enabling LAN (recorded in the #18 note).
