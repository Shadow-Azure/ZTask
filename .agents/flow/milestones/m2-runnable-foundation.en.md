# Stage 2: Runnable full-stack foundation

English | [中文](m2-runnable-foundation.md)

```yaml flow
kind: milestone
id: m2
title: 阶段 2：可运行全栈基座
status: planned
github:
  number: null
  url: null
```

Establish a local full-stack workspace that starts with one command and fixes the shared API, file-storage, and frontend-shell boundaries. This stage delivers infrastructure only and does not implement the task workflow early.

## Delivery boundary

- Deliver only the capabilities declared by this stage's issues; do not hide later-stage features in early implementations.
- Follow `plan/fullstack-design/` and the approved prototype for all implementation; record non-trivial decisions as Agent Notes.

## Stage acceptance

- One command starts Fastify and the same-origin Vue web app, listening on loopback by default.
- Shared DTOs, the error model, and file write/recovery protocols have executable automated tests.
- Admin and member routes, prototype design tokens, request caching, and the responsive shell are reusable.
