# Agent Note: Task List Subtask and Progress Overview

Status: implemented

English | [中文](2026-11-01-task-list-overview.md)

## Problem

The [m1-01 prototype](../../../../plan/m1-01-ui-prototype/ztask-prototype.html) tracker list showed only a subtask count and the first progress line, while permanently rendering subtasks as independent table rows. Users could not assess subtask completion or read complete progress within the parent task context without opening the edit modal.

## Decision

The tracker now uses always-visible, read-only task cards instead of table columns, disclosure buttons, quick progress editing, or add/delete actions. Each task has one outer container: a header with the task name, owner, importance, due date, and overall progress, and a content area with subtask progress and complete progress detail in two columns. The default split is 36% for subtasks and 64% for detail. A separator supports pointer dragging and arrow keys within a 26%–55% range, synchronizes all task cards, and preserves its width across list rendering. Nested cards are removed. Subtasks use a progress ring with a centered percentage, blue while active and green when complete. The owner avatar and name appear below the subtask name; empty data uses lightweight text. Clicking the header or either content pane (subtask progress / progress detail) opens the existing edit modal; dragging to select text inside a pane does not trigger it, and all modification stays in the modal. Narrow screens stack the content into one column.

## Alternatives considered

A right-hand detail drawer was rejected because the page already has a tree and task board. Per-task accordions were rejected because users need to see every task's progress directly, while expansion state adds work and visual fragmentation. Nested cards and inline actions were rejected because they split one task into separate visual islands and confuse read-only review with editing.

## Consequences

The list now continuously presents subtask completion and full progress in a unified container. The task header and both content panes are entries to the edit modal, and dragging to select text does not trigger it. Inline quick progress, add, and delete controls are removed from the list, while filtering, search, and task creation remain. Tests cover `subtaskSummary` and read-only card rendering; browser verification covers directly visible content, absence of list edit controls, modal opening, keyboard operation, filtering, and empty states.
