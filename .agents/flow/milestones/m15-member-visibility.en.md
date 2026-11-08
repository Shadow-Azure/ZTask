# Milestone 15: Whole-team visibility for member links with owner-only writes

English | [中文](m15-member-visibility.md)

```yaml flow
kind: milestone
id: m15
title: 阶段 15：成员链接全团队可见与负责人写边界
status: planned
github:
  number: 17
  url: https://github.com/Shadow-Azure/ZTask/milestone/17
```

Member links move from "only tasks related to me" to "all team tasks are visible, and only a main-task owner can write the progress, detail and subtasks of a task they own". The milestone updates the backend read scope, the three-group member home with collapsible headings, the read-only tracker/dashboard/history, and the related docs and tests.

## Delivery boundary

- Only the member read scope and the home grouping/collapse change; admin capabilities, storage and share-link lifecycle stay unchanged.
- Writes remain owner-only; collaborators, subtask-only assignees and other members are read-only.
- The tracker stays fully read-only; owner editing remains on the member home page only.
- No per-task privacy switch, account system or cross-device collapse persistence.

## Acceptance

- The member home shows owned/collaborated/other tasks exactly once, expanded by default, with collapsible headings; other-member cards are read-only.
- The member tracker, folder tree, dashboard and history cover all team tasks; even the member's own tasks are read-only there.
- Admin APIs, the write queue, version conflicts and share-session semantics are unchanged.
- `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` and `pnpm verify:flow` are green.
