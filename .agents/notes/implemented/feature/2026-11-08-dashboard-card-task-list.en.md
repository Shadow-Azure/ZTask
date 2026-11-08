# Agent Note: Dashboard card task list

Status: implemented

English | [中文](2026-11-08-dashboard-card-task-list.md)

## Problem

The stat cards in the [prototype](../../../../plan/m1-01-ui-prototype/ztask-prototype.html) and the real dashboard expand only the due-date distribution chart. After seeing "2 done" or "3 in progress", users cannot tell which tasks make up the number and cannot open a task directly from the statistic. The task management list carries CRUD and filtering, so it is not a good second step for "check the statistic, then inspect the details". The user asked for a concise paginated task list below the chart with a row opening the existing task dialog, and asked to confirm the prototype layout before real development.

## Decision

Inside the chart panel opened by any stat card, show the task list below the bar chart and x-axis: 5 rows per page, each row composed of an importance dot, task description, importance chip, owner avatars, progress bar, and due date, with a chevron hinting that the row opens the task. The footer shows the page size, total count, current page / page count, and previous/next buttons. The list uses the same task set as the chart; changing the card, member filter, or folder resets to page one; clicking a row reuses the existing task entry: the admin edit dialog for admins and the read-only detail dialog for members. An empty set keeps the existing empty state and renders no list.

The server reuses the folder / member / share scope in `scopedAggregates` and adds `GET /admin/dashboard/tasks` and `GET /share/dashboard/tasks`: they return only the list display fields, sort stably by `createdAt,id`, use the same base64url opaque cursor as the task list, fix the page size at 5, and return the total. The frontend keeps a cursor stack for previous/next instead of building offsets. A loading guard prevents the current page from resetting when a page query briefly has no data. The real UI matches the confirmed prototype; captures are in `plan/m1-01-ui-prototype/review/90–98`.

## Alternatives considered

We rejected placing the task list inside each stat card because three cards side by side lack the height and width for readable rows and would squeeze the importance counts. We rejected 10 or 20 rows per page because the user asked for a compact list and 5 rows stay visible below the chart in one screen. We rejected navigating to the task management page before opening the dialog because the extra context switch defeats the purpose of going from a statistic to its details. We rejected showing only the task description because importance, owners, progress, and due date are the key facts for judging the set; without them users still need the dialog to decide. On the server we rejected reusing the `/admin/tasks` list because it does not filter by progress bucket and would bring filter/task-card fields into the dashboard; we rejected returning the whole bucket and paginating in the browser because it inflates responses and departs from the repository cursor convention.

## Consequences

When a bucket has 1–3 tasks the pager shows 1/1; page two appears only with more than 5 real tasks. The dashboard list polls every 15 seconds like the stat cards, and the cursor only describes a position. If tasks are deleted or move buckets between refreshes, the current page can become short; when the total shrinks outside a loading state the frontend returns to page one instead of staying on an empty page. The API adds only a read-only list and does not change the task data protocol, statistics semantics, or member visibility. The real implementation includes server/component tests and actual-app before/after captures; the full suite passes 476 tests.
