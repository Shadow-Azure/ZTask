# Agent Note: Member administrator permission and LAN admin-page access

Status: implemented

English | [中文](2026-11-09-member-admin-access.md)

## Problem

ZTask previously had only two identities — local administrator and LAN member ([01](../../../../plan/fullstack-design/01-architecture.md) §4, [04](../../../../plan/fullstack-design/04-backend-architecture.md) §4.1, [05](../../../../plan/fullstack-design/05-api-design.md) §1): the Admin API required a loopback listener, a loopback remote address and a trusted Host, `/api/v1/admin/*` on the LAN listener always returned 403, and member share links opened only the member home page and the read-only tracker. The user asked to "grant a member administrator permission; once the member has it, the link opens the administrator page". That means a share-link identity can carry administrative capability, so the authorization boundary, session-cookie scope and LAN Admin exposure need an explicit decision.

## Decision

- **A flag on the member record**: a v2 migration appends a boolean `members.is_admin` column defaulting to false; existing databases upgrade and legacy file imports keep every member non-admin. The member create/update DTO accepts `isAdmin`, the member editor has an "administrator permission" checkbox, and the member list shows a badge.
- **Share links land by permission**: `/share/session` returns `isAdmin`. After exchanging a token, an administrator member is replaced to `/#/tracker` while a normal member stays at `/#/s/home`; the token is still removed from the address bar.
- **LAN Admin API opens to administrator members**: in addition to the existing loopback + loopback peer + trusted Host rule, the Admin guard allows requests on the LAN listener when they carry a valid member session whose member currently has `isAdmin=true`. The session does not cache the admin bit; every request re-reads the member row. Revoking the flag, archiving the member, or rotating/revoking the link removes Admin access from a residual session immediately.
- **The session cookie covers the origin**: `ztask_share_session` changes its Path from `/api/v1/share` to `/`, so an administrator member can call `/api/v1/admin/*` with the same HttpOnly + SameSite=Strict session; a non-admin session is rejected by the Admin guard even when it carries the cookie. Exchange, restore and logout explicitly clear the legacy Path copy; restore also refreshes a legacy-path session to Path=/, preventing an upgraded browser's old cookie from pre-empting a new link request.
- **The admin shell validates its entry**: opening the admin page from a loopback host keeps the sessionless local administrator; opening it from a LAN host first calls `GET /share/session` and renders admin navigation only for an administrator member. Normal members, missing sessions and restore failures get explicit pages, and no Admin API request is sent first.
- **Capability scope**: an administrator member gets the complete Admin API (tasks, members, dashboard, history, backup, network and share-link management), matching the permission bit. No separate read-only-admin or task-admin tier is introduced.

## Alternatives considered

- Duplicate an admin API under the share domain: double implementation, double authorization and double tests that would drift; rejected.
- Only redirect the admin link on the frontend without relaxing the server: the page would open but every Admin request would be 403, leaving an empty shell; rejected.
- Keep loopback-only and require the member to operate on the service host: does not satisfy "the link opens the administrator page"; rejected.
- Issue a separate link or account type for administrators: introduces a second credential lifecycle and forces re-issuing links on promotion/demotion, costing more than a boolean on the member record; rejected.
- Put an admin token in the URL query: it would enter logs/Referer/history and violate the existing rule that share tokens live only in the fragment; rejected.

## Consequences

- The threat model changes from "the LAN only exposes the member scope" to "the LAN can expose the complete Admin API". A stolen session cookie on an administrator member's device is equivalent to administrator access; revoking the permission, archiving the member, or rotating/revoking the link is the mitigation, effective per request.
- Task changes made by an administrator member on the admin side are still recorded with `actor.kind=admin` and `actor.name=管理员`; the specific member is not distinguishable in revisions yet. If identity auditing is needed later, the Admin principal must be passed into the revision write path.
- The admin page and the member page share one SPA and one session cookie. An administrator member can still open `/s/home` manually, but link entry always lands on the admin page. This avoids building a second shell for the member view.
- Existing SQLite databases migrate to schema v2 automatically; backup, restore and `doctor` keep validating by schema version. Members imported from legacy files are always non-admin and need an explicit grant.
- The new frontend entry gate affects experience only; the server Admin guard remains the single authorization boundary. Tests cover no session, normal member, administrator member, revocation and administrator-link landing.
