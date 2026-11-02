# Stage 5: Insights, recovery, and release hardening

English | [中文](m5-insights-recovery-release.md)

```yaml flow
kind: milestone
id: m5
title: 阶段 5：看板历史与交付加固
status: done
github:
  number: 5
  url: https://github.com/Shadow-Azure/ZTask/milestone/5
```

Complete dashboard metrics and historical diffs, then prove first-release readiness through recovery, backup, access-isolation, and end-to-end acceptance.

## Delivery boundary

- Deliver only the capabilities declared by this stage's issues; do not hide later-stage features in early implementations.
- Follow `plan/fullstack-design/` and the approved prototype for all implementation; record non-trivial decisions as Agent Notes.

## Stage acceptance

- Admin and member dashboards return consistent metrics, distributions, and changes within their respective data scopes.
- History restores before/after snapshots over [start,end), with two-column diffs and deleted-task presentation matching the prototype.
- Crash recovery, online backup, access isolation, desktop/narrow-screen behavior, and concurrent main flows are repeatably verified.
