# Agent Note: All team tasks visible to member links, owner-only writes

Status: implemented

English | [中文](2026-11-08-share-all-task-visibility.md)

## Problem

[02](../../../../plan/fullstack-design/02-features.md) §4–5 and [05](../../../../plan/fullstack-design/05-api-design.md) §6 previously limited members to tasks related to them (main-task owner/collaborator or subtask assignee), and the read-only tracker, dashboard and history applied the same scope. The user confirmed a new rule: members may view every team task, only owners may edit the content of tasks they own, and the member home page shows three groups — owned, collaborated and other members' tasks — expanded by default with collapsible headings. This changes the sharing link's privacy boundary, API read scope, home grouping, tracker/dashboard/history data sources and test assumptions, so the decision and its consequences need a record.

## Decision

- **All-task read scope**: every non-deleted main task, folder tree, dashboard and history is available to a valid member session. `GET /share/tasks?view=home` returns `owned / collaborated / others` as a partition; the tracker and folder tree return the whole team, and the tree keeps empty folders and matches the admin tree.
- **Complete DTOs**: `toMemberTask` keeps the full `detail` and every non-deleted subtask; `ShareTaskDetail.memberRole` adds `viewer` for a member with no main-task assignment. Dashboard and history no longer filter by `shareMemberId`; `memberIds` only filters by main-task owner.
- **Write boundary unchanged**: only the main-task owner may write progress, full detail and one-level subtasks. A non-owner (collaborator, subtask-only assignee or other member) gets 403 `OWNER_REQUIRED`; a nonexistent or soft-deleted task or a subtask id gets 404 `TASK_NOT_FOUND`. Members still cannot change the description, assignments, importance, due date, folderId or delete a main task.
- **Member home interaction**: the three headings are expanded by default; clicking a heading collapses/expands it and keeps the count. The heading is a button with `aria-expanded`/`aria-controls` and supports Enter / Space. Other members' cards are labelled "其他成员 · 只读".
- **Prototype first**: `plan/m1-01-ui-prototype/ztask-prototype.html` already reflects the confirmed three groups, read-only labels and collapse behavior as the implementation baseline.

## Alternatives considered

- Keep the owner/collaborator visibility scope: stronger privacy, but contradicts the user's explicit decision that all team tasks are visible; rejected.
- Make every task editable for every member: privilege escalation and a conflict with the member write boundary; rejected.
- Make only the tracker all-visible while the home page keeps two groups: the same member would see different task sets on two pages, and the user confirmed three home groups; rejected.
- Add a per-task "public" flag: extra model and migration cost for a requirement that is team-wide; rejected.
- Keep the `shareMemberId` filtering branches: they would be unreachable dead code and mislead future work; removed.

## Consequences

- A share link becomes a read-only directory of team tasks: any member with a valid link can read every task description, detail, subtask, dashboard and history. If private tasks are needed later, a new visibility model is required; a flag on the existing link is not enough.
- Writes remain owner-only. Permission tests change from "other member's task is 404" to "all tasks are visible with 200 + viewer; a non-owner write is 403".
- The member-scope branches in dashboard, history and the folder tree are deleted, simplifying implementation and tests; `memberIds` becomes an ordinary owner filter.
- Group collapse state lives only in the current page session; a reload returns to the default expanded state, with no cross-device or cross-session persistence.
