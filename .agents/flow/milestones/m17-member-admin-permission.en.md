# Stage 16: Member administrator permission

English | [中文](m17-member-admin-permission.md)

```yaml flow
kind: milestone
id: m17
title: 阶段 16：成员管理员权限
status: active
github:
  number: 18
  url: https://github.com/Shadow-Azure/ZTask/milestone/18
```

This stage delivers member administrator permission: an administrator can mark a member as an administrator in the member management page; that member's share link lands on the admin page and the same share session can call the Admin API over LAN. Authorization follows the member's current `is_admin` on every request, so revoking the flag, archiving the member, or rotating/revoking the link takes effect immediately.

## Delivery boundary

- Add an administrator flag to member records, visible in create/edit and the list; database upgrades and legacy imports keep every member non-admin.
- An administrator member's link enters the admin page; normal member links keep the member home page and read-only tracker.
- The LAN Admin API stays closed by default and opens only to administrator-member sessions; the server remains the single authorization boundary.
- Sync the change to the design documents, Agent Note, tests and real UI, keeping before/after captures of the same scenario.

## Stage acceptance

- An administrator can grant/revoke administrator permission in the member editor, and the list shows the state.
- An administrator member's share link enters the admin page and can complete an admin operation; normal members and missing sessions remain rejected.
- After revoking the flag, archiving the member, or resetting/revoking the link, a residual session loses Admin access immediately.
- `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` are green.
