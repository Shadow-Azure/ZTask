# Stage 4: Sharing and member collaboration

English | [中文](m4-sharing-collaboration.md)

```yaml flow
kind: milestone
id: m4
title: 阶段 4：分享与成员协作
status: done
github:
  number: 4
  url: https://github.com/Shadow-Azure/ZTask/milestone/4
```

Implement controlled LAN read-only sharing, member identity sessions, and minimal member writes while keeping admin APIs inaccessible from LAN connections.

## Delivery boundary

- Deliver only the capabilities declared by this stage's issues; do not hide later-stage features in early implementations.
- Follow `plan/fullstack-design/` and the approved prototype for all implementation; record non-trivial decisions as Agent Notes.

## Stage acceptance

- Dynamic LAN listening, share URLs, link generation/rotation/revocation, and old-session invalidation behave consistently.
- Members can access only their related data; owner and collaborator permissions are enforced by both API and UI.
- Member home supports progress, detail, and subtask updates for owned tasks, while the tracker remains read-only.
