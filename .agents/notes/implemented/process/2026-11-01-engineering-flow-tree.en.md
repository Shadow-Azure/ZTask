# Agent Note: Split the engineering flow tree by verifiable delivery boundaries

Status: implemented

English | [中文](2026-11-01-engineering-flow-tree.md)

## Problem

After completing the prototype and full-stack design, the many frontend and backend capabilities need independently verifiable work units. Reusing StudyWiki’s proven flow gates also avoids page- or layer-only splits that postpone permissions, recovery, and history.

## Decision

Preserve M1 design history and add 12 issues across M2 runnable foundation, M3 admin task workflow, M4 sharing and member collaboration, and M5 insights, recovery, and release hardening. Organize milestones around end-to-end capabilities and deliver permission, version, and file-recovery constraints with their owning stage instead of deferring all cross-cutting risks. Synchronize StudyWiki’s current flow scripts, standalone tests, and skills. All new objects remain in backlog because GitHub has not been synchronized.

## Alternatives considered

- Separate frontend, backend, and storage milestones: interfaces would wait across stages and main flows could not be verified early, so rejected.
- One issue per API or page: too many items with fragmented acceptance, so combine work into independently reviewable capability units.
- Run `flow:sync` immediately: this delivery plans only the local flow tree and creates no remote objects, so rejected.

## Consequences

- When a remote issue has been deleted (GitHub returns 404), the online gate only warns about it and skips that entry while states, milestones, and URLs are still checked strictly; the local flow tree keeps its history instead of turning every PR red after a remote cleanup.

Implementation can begin with M2’s same-origin service, file protocol, and shared shells, then produce a working product loop at each stage. GitHub numbers and issue state transitions are required before work starts. If unresolved design questions change contracts, revise the design and affected issues first instead of silently diverging during implementation.
