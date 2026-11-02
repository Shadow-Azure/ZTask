# Agent Note: Share Session Trust Boundary and Session Lifecycle

Status: implemented

English | [中文](2026-11-02-share-session-boundary.md)

## Problem

A share link is only a credential: what actually isolates member data is "exchange the token for an HttpOnly session + re-validate on every request + scope queries by memberId", and hiding entry points in the frontend is not authorization. The [fullstack design](../../../../plan/fullstack-design/05-api-design.md) 05 §6 and [07](../../../../plan/fullstack-design/07-backend-implementation.md) §3.2 already fix session exchange, cookie attributes, and invalidation semantics, but not whether an invalid token returns 401 or 404, which issue owns share-link mint/rotate/revoke, or whether the member-visible tree reuses the admin tree or ships its own copy. Implementing each of those independently would make #19 (member writes) and #20 (link lifecycle) disagree about permissions.

## Decision

- **Credential boundary**: the raw token appears only in the `POST /share/session` body; the server persists only its SHA-256 (`share-links/<memberId>.json`), and sessions persist only a `verifierHash` (`auth-sessions/<sessionId>.json`). The cookie value is `<sessionId>.<verifier>` with `HttpOnly; SameSite=Strict; Path=/api/v1/share; Max-Age=30d`.
- **Re-validate every request**: session file exists → constant-time verifierHash comparison → not expired → member not archived → `shareLinkId` still an active link. Revocation takes effect immediately through the last step without relying on deleting session files.
- **Error-code choices**: exchange failures return `401 SHARE_LINK_INVALID` (an unknown credential is an authentication failure); missing/expired sessions return `401 SHARE_SESSION_REQUIRED`; unrelated tasks return `404 TASK_NOT_FOUND` (no existence leak). The exchange endpoint is rate-limited per source IP with a fixed window and returns `429 SHARE_EXCHANGE_RATE_LIMITED` when exceeded.
- **Ownership and read-only**: #18 delivers only sessions and read-only queries; share-link mint/rotate/revoke endpoints belong to #20 and member personal-page writes to #19. #18 tests seed link files directly through fixtures instead of pulling minting into production code early. The tracker renders and registers no write mutations in the member scope.
- **Single scope construction point**: `share-scope` decides member-visible tasks in one place (main-task owner/collaborator, or an assignee of a visible subtask), and the folder tree reuses `folder-service.tree(member-visible aggregates)` instead of duplicating tree building and counting.

## Alternatives considered

- Returning 404 for an invalid token (the 05 §7 error table lists `SHARE_LINK_INVALID` alongside 404): inconsistent with "invalid credential = authentication failure" and it prevents the frontend from using one 401 branch to reach the invalid page; 401 is kept and the deviation is recorded in the PR.
- Persisting the raw token so administrators can copy it anytime: saves a "rotate" but writes a long-lived credential to disk — rejected; #20 stores hashes only and regenerates.
- Writing a separate `buildMemberTree` for members: faster to implement, but its counting semantics drift from the folder service, so the same tree would differ between admin and member views.
- Implementing link minting/rotation inside #18: duplicates #20's lifecycle endpoints and forces #18 to answer "reset does not invalidate old sessions", which rotation semantics own.

## Consequences

- **Hard constraint for #20**: rotation must issue a new `linkId` (and delete stale session files when needed); otherwise an old cookie stays valid under the `shareLinkId` check.
- Sessions and links are scanned per file; member/link growth will need an index (debt, acceptable at v1 scale).
- The frontend funnels member-scope 401s into "clear the share cache + go to the invalid page"; admin 401s do not take that path, avoiding collateral damage.
- When #19 adds member writes, it must re-validate session, link status, and the owner role inside the write queue (07 §37) instead of trusting frontend disabling.
