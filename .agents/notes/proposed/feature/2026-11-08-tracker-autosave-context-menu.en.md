# Agent Note: Prototype autosave and tree permissions

Status: proposed

English | [中文](2026-11-08-tracker-autosave-context-menu.md)

## Problem

The [prototype](../../../../plan/m1-01-ui-prototype/ztask-prototype.html) currently relies on the task dialog's "Save", the member dialog's "Save", and the member view's "Save progress"; editing has no global change detection or autosave feedback. The left task tree has no management entry: admins create tasks from the right toolbar and delete them only inside the dialog. The member personal page has no left tree, so the admin/member permission difference in tree actions is invisible. The user wants service-wide periodic detection with autosave by default, configurable off via `~/.ztask/settings.json` or a `ztask` command; both the admin tree and the member personal page tree should support right-click, with admin-only items grayed on the member side and an "Admins only" label on each corresponding option row so members can be granted actions incrementally later.

## Decision

Place one autosave status in the admin tracker, member management, and member view top bars: "Autosave / checks every 5 seconds" by default, "Changes detected / saves within 5 seconds" after an edit, "Saving automatically…" during a save, "Saved automatically / HH:MM:SS" when complete, and "Unsaved changes / complete required fields to autosave" when validation blocks the save. Clicking the status opens a settings popover with a switch, an `autosave.enabled` example in `~/.ztask/settings.json`, and the `ztask autosave off` / `on` commands; it is on by default and treated as on when the config is missing. When off, the status shows "Autosave is off", task/member dialogs return to "Cancel / Save", member-view progress returns to "Save progress", and closing a dialog with manual edits asks before discarding.

Connect task and member dialogs to autosave: existing objects write to prototype memory after input and refresh the tree, cards, or table, and the footer changes from "Cancel / Save" to "Changes save automatically / Done". New tasks and members keep explicit "Create task" or "Add" actions. Member-view progress also enters autosave, with the manual "Save now" retained as a fallback; progress detail appends still apply immediately.

Support right-click on both the admin tree and the member personal page tree. Menu items carry `requiresAdmin` metadata: admins see enabled actions, while members see the same actions with admin-only items grayed and an "Admins only" label on each corresponding option row. Right-clicking a folder shows "New task" and "New subtask folder"; right-clicking a task shows "New task" and "Delete task". The menu header shows only the target; deletion keeps the confirmation dialog. The member personal page tree includes all team tasks currently visible to members and their ancestor folders; cards keep the "Owned / Collaborating / Other members" groups with collapsible headings, and selecting a folder filters only the cards without changing the tree's team scope. The member tree offers no actual write action.

This delivery updates only the static prototype, specification tests, review screenshots, and flow/decision records; it does not change the real `apps/web`, server save protocol, or CLI implementation.

## Implementation status

The tree context menu now ships in the real `apps/web`: `FolderTreeNode` emits the menu target, and `TrackerView` renders the shared menu and performs new task, new subtask folder, and delete task. Admin actions are enabled; the member tracker tree keeps the same actions but grays out admin-only items and shows "Admins only" on each row. Creation and deletion reuse the existing task editor, API, and confirmation dialog. Autosave settings, `~/.ztask/settings.json` read/write, and the `ztask autosave` command remain prototype-only and are the next implementation contract.

## Alternatives considered

We rejected the previous "hide the context menu from members" approach because the user wants members to see the menu and understand which actions are temporarily unavailable, and it makes incremental openings easier. We rejected a single "Admins only" badge in the menu header because it cannot distinguish individual options and would mislead when one option is later opened to members. We rejected keeping in-memory autosave after disabling it because the setting would be meaningless. We rejected creating new tasks or members on a timer because incomplete required fields would produce half-finished records. We rejected showing only the member's related tasks in the tree because the main branch now lets members see all team tasks, so the tree must match the card scope. We also rejected resetting group collapse on every folder filter because a group the user just collapsed should not reopen when they select a folder. We rejected putting folder deletion in the folder menu because deleting a folder cascades to tasks, exceeds the requested create/delete-task scope, and has different confirmation semantics.

## Consequences

Prototype data lives only in memory, so autosaved changes do not survive a reload; the settings switch does not actually read or write `~/.ztask/settings.json`, and the CLI command is only a design contract. The real implementation still needs server-side version conflicts, permissions, and audit rules, plus settings read/write and a `ztask autosave off|on|status` command; the member tree versus team-wide scope, group-collapse behavior, which member actions to open, and whether the interval is configurable remain for prototype confirmation. The design documents and real frontend/CLI follow after that confirmation.
