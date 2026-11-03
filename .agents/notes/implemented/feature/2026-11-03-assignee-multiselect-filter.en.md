# Agent Note: assignee multi-select filter in the task management prototype

Status: implemented

English | [中文](2026-11-03-assignee-multiselect-filter.md)

## Problem

The [m1-01 prototype](../../../../plan/m1-01-ui-prototype/ztask-prototype.html) task management view can filter only by importance and keyword, so users cannot locate tasks by assignee. Assignees exist on both main tasks and subtasks: filtering by main-task owner alone misses tasks where the user owns a subtask, while filtering by subtask owner alone incorrectly hides the main task. The filter must also combine with the existing importance and search conditions so users can narrow the result set.

## Decision

Add a multi-select assignee dropdown to the toolbar; selected members form a union. For each task, check the main-task owners first: if any selected member owns the main task, keep the whole task and every subtask without pruning by subtask owner. Otherwise keep only the subtasks whose owner is selected, keep the main task itself, and annotate the card with "filtered by assignee; only subtasks owned by the selected people are shown". The subtask completion count reflects the visible subtasks. The assignee filter intersects with importance and keyword search; search still matches only the main task description. Extract the matching logic into the pure function `taskAssigneeMatch`, covered by specification tests for main-owner match, subtask-only match, no match, empty selection, and multi-select union. To demonstrate the "subtask owner is not the main-task owner" branch, the prototype demo data changes the owner of "大数据量虚拟滚动" under "任务树组件重构" to 赵敏.

## Alternatives considered

We rejected separate "main-task owner" and "subtask owner" filters because splitting the same member set across two controls forces users to understand two semantics to find everything. We rejected hiding only non-matching subtasks while showing every main task, because a task with no matching subtask would render an empty card. We rejected extending search to subtask descriptions because that changes existing search semantics and adds an extra rule about whether a subtask-only search hit should prune siblings, beyond this filter request. We rejected implementing it directly in `apps/web` because this delivery covers only the prototype and screenshots; a real implementation needs server-side query support.

## Consequences

The prototype can now filter by multiple assignees: a main-owner match shows the complete task, while a subtask-owner-only match shows a subset. The visible subtask completion count can be lower than the task's total subtask count, and the in-card note explains the difference; task-tree counts and dashboard statistics are unaffected by the filter. A future real implementation must move the same semantics into the query layer and handle archived members, tasks without subtasks, and subtasks with multiple owners. Specification tests cover `taskAssigneeMatch` and filtered card rendering.
