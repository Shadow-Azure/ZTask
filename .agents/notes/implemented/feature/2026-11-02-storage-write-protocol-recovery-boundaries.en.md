# Agent Note: Storage Commit Protocol Index Freshness and Runtime Recovery Boundaries

Status: implemented

English | [中文](2026-11-02-storage-write-protocol-recovery-boundaries.md)

## Problem

The [fullstack design](../../../../plan/fullstack-design/06-database-design.md) (06 §8.2 and 04 §5.2) requires the task commit protocol to end with "update in-memory indexes" and to rebuild immediately when current/index updates fail. m2-file-storage (#13) delivers the storage layer while no query service consumes those indexes, and introducing an in-process degraded state machine just to satisfy the literal ordering would pull complexity into the write path with no beneficiary.

## Decision

The #13 commit protocol ends at "atomically publish current": re-check expectedVersion inside the queue → append the revision (append+fsync is the logical commit point) → atomically publish current. `commit` does not touch runtime indexes; index freshness comes from two places — full rebuild at startup via `initStore`, and explicit `rebuildIndexes()`. A runtime failure between append and current publish returns the error to the caller; persistent-consistency recovery is deferred to the next startup (startup recovery covers the real crash window and rebuilds current whenever it lags the tip). When #15 wires the task-service in, it must add index invalidation/rebuild on the commit path plus a fault-injection seam for the index-update step.

## Alternatives considered

Rebuilding all indexes after every commit: feasible at v1 data volume, but couples query semantics into the write path, rescans everything each time, and is pure overhead while no consumer exists. An in-process degraded state machine (mark degraded and pause reads/writes on publish failure): strictly satisfies the literal 04 §5.2 ordering, but no consumer benefits yet and the degraded semantics would have to thread through health checks and the route layer — that belongs to #15.

## Consequences

`store.indexes` is a startup snapshot and does not update automatically on commits — before #15, any index consumer must call `rebuildIndexes()` first or implement commit-driven incremental updates. Within the runtime publish-failure window, retrying with the stale expectedVersion yields a version conflict (files already hold the new version) rather than a phantom duplicate revision; cross-process consistency is always backstopped by startup recovery. This note is the anti-omission anchor for #15 when it implements commit-driven index updates and the injection seam.
