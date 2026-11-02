# Agent Note: Member Write Boundary: Owner Minimum Writes and Aggregate Version

Status: implemented

English | [中文](2026-11-02-member-owner-write-boundary.md)

## Problem

The member home page needs write access, yet member permissions are far smaller than an administrator's. [02](../../../../plan/fullstack-design/02-features.md) §4.2–4.3 and [05](../../../../plan/fullstack-design/05-api-design.md) §6.6–6.10 fix the endpoints and fields for "owners update progress/details/subtasks, collaborators are read-only", and [07](../../../../plan/fullstack-design/07-backend-implementation.md) §3 requires writes to flow through the aggregate queue and revisions; but the design does not settle four implementation boundaries: how ownership is decided, whether a member may choose a subtask owner, whether the server merges drafts on 409, and whether a no-op change still appends a revision. Those four decide whether member writes can escalate privileges or fabricate history.

## Decision

- **Only the main-task owner**: writes require `(taskId = main task, kind = owner, memberId = session member)` in `assignments`; an invisible task (unrelated member, soft-deleted, or a subtask id) gets 404 `TASK_NOT_FOUND`; a visible non-owner (main-task collaborator or subtask-only assignee) gets 403 `OWNER_REQUIRED`.
- **Minimal write surface**: only `progress`, `detail`, and the three `subtasks` endpoints are exposed; main-task description, assignments, importance, due date, `folderId`, deleting the main task, and creating top-level tasks stay closed. JSON schema `additionalProperties:false` rejects first, and the service rejects unknown fields again (subtasks explicitly reject `owner`/`ownerId`).
- **Subtask rules**: one level only; the owner is forced to the current member on create; edits cannot change the owner; delete is a soft delete that also drops the subtask's assignments; the `subtaskId` must belong to the main task in the path.
- **One shared write queue**: admin and member writes use the `store.tasks` injected by `buildApp` (the same `WriteQueue`) instead of each creating its own `createTaskStore`. With two queues, concurrent commits at the same `expectedVersion` both succeed, revisions repeat a version, and the worst case leaves `revisionTip` inconsistent with the latest revision so the next startup refuses to repair. Inside the queue the `mutate` callback re-checks ownership against the latest current (07 §2.3), so a write is dropped if the owner was revoked after the pre-check.
- **Version and revision**: every write must carry the aggregate `version`; a mismatch returns 409 `TASK_VERSION_CONFLICT` with `details.current` being the member-visible DTO. Writes go through `taskStore.commit` with actor `{ kind: "member", memberId, name }` and changeKind progress/detail/subtask. `canonicalJson` detects no-op changes: nothing is committed, no revision is appended, and the response has `revision: null`.
- **Response shape**: always the share-side `toMemberTask`, isomorphic to member GET and leaking no admin fields. The frontend locks the base version when a draft first becomes dirty (never the latest value at submit time), otherwise "old draft + new version" bypasses the 409 and silently overwrites someone else; the conflict banner consumes `details.current` to show the server's current version and progress, keeps the drafts, and offers only "discard drafts and refresh". No auto-merge.

## Alternatives considered

- Reusing the admin `PATCH /admin/tasks/{id}`: would also open description, assignments, and importance — effectively granting admin capability to members — rejected.
- Letting members pick a subtask owner or collaborators: conflicts with "minimum writes" and bypasses the administrator's assignment authority — rejected.
- Field-level auto-merge on 409: cannot infer user intent (especially for full detail replacement) and silently drops writes — rejected; the frontend keeps drafts and the user re-submits after refreshing.
- Append-only detail edits (old prototype): 02 §4.2 explicitly allows editing the full current text and appending a snapshot, so the append input was replaced with an editable textarea — rejected.
- Recording member writes as `admin` revisions: history could no longer distinguish the member's action from the administrator's — rejected.

## Consequences

- Member and admin writes share one aggregate, version, and revision protocol, so conflict semantics stay identical.
- A subtask owner is always the current member; "owner assigns subtasks" would need a separate issue and a permission-model change first.
- Frontend conflicts keep drafts and show the server's current version; the only recovery is "discard drafts and refresh", never auto-merge, to avoid silently overwriting a newer server version.
- Collaborator cards render progress as a non-interactive `role=progressbar` instead of the prototype's `disabled` slider: both are equivalent on the server (02 §4.3 allows disabled or omitted), but a read-only display is not announced as "control, disabled" by screen readers.
- Archived members are already rejected at session level (#18), so member writes do not re-check archival, but the service still authorizes purely by ownership.
