# Agent Note: Replacing per-aggregate file storage with a single SQLite database

Status: implemented

English | [中文](2026-11-05-sqlite-storage.md)

## Problem

The current storage splits members, folders, task aggregates, history, share links, sessions, and network configuration into JSON/JSONL files. To stay consistent after a crash, the application layer must implement temporary-file + fsync + rename, JSONL checksums and tail recovery, current/revision-tip reconciliation, startup index rebuilds, and cross-entity references by convention. Correctness is spread across atomic writes, recovery, indexes, and services, so a new query or entity can easily miss a recovery path. The user explicitly asked to change the current file structure to SQLite.

## Decision

- Use a single `ztask.db` as the only authoritative business database, opened through `better-sqlite3` (Kysely `SqliteDialect`) with WAL, `synchronous=FULL`, and foreign keys on; keep the data-directory lock and the single-process write queue.
- Normalize current state into `members`, `folders`, `tasks`, `assignments`, `share_links`, `auth_sessions`, `network_config`, and `meta`; main tasks and subtasks share the version in `task_aggregates`.
- Keep history as immutable full JSON snapshots in `task_revisions`, with the existing canonical-JSON SHA-256 checksum; current state and history are not synchronized in both directions.
- Make every effective change one `BEGIN IMMEDIATE` transaction: revision, current state, and aggregate tip commit together; re-check version conflicts inside the transaction; write no revision for a no-op.
- Import legacy files through a one-time loader into a temporary database, verify it, atomically rename it, then move the old tree to `backups/pre-sqlite-*`; the same loader restores old backups.
- Store the schema version in `PRAGMA user_version`, take a `VACUUM INTO` backup before migration, and run migrations in a transaction; use `integrity_check`, `foreign_key_check`, and revision-sequence/tip assertions at startup, backup, restore, and in doctor.
- Produce single-file consistent snapshots for online backup with `VACUUM INTO`; the backup directory holds `ztask.db` plus `backup.json`.
- Run schema migrations through Kysely Migrator: `kysely_migration` records execution state and `schema_migrations` stores version/checksum audit rows; take a `VACUUM INTO` backup first, then run transactionally at startup. An in-house runner, Umzug, Drizzle/Prisma, and external CLIs remain alternatives in 06 §7.3.1.

The detailed contract is in [fullstack design 06](../../../../plan/fullstack-design/06-database-design.md).

## Alternatives considered

- Keep per-aggregate JSON + JSONL and harden recovery: preserves plain-text readability and no native dependency, but atomic writes, tail recovery, current reconciliation, and derived indexes remain application responsibilities, and cross-entity consistency remains by convention; rejected.
- Use `node:sqlite`: no native dependency, but an experimental API and a Node 22.13+ floor; high-star Node/Electron projects use better-sqlite3 or sqlite3, so this was rejected.
- Introduce an ORM: the query surface is small and precise transaction and SQL-plan control matters, so hand-written SQL plus repositories is more transparent; rejected.
- One database per aggregate: smaller transaction boundaries, but backup, migration, cross-entity queries, and reference checks are more complex; a single database fits the current scale; rejected.
- Normalize history fully into relational tables: history is an immutable whole snapshot, and old snapshots would be affected by new constraints as fields evolve; keep the JSON snapshot; rejected.

## Consequences

- Lose the transparency of one readable JSON file per entity; diagnostics move to `sqlite3` or read-only connections, and manual editing is no longer supported.
- Migration is one-way: an older application cannot read `ztask.db`, and rollback relies on `backups/pre-sqlite-*`.
- `better-sqlite3` is pinned to `12.9.0`, the last release that ships prebuilt binaries for Node 20 (ABI 115); the install script downloads prebuilds through the npmmirror host configured in `.npmrc`, avoiding local compilation. The trade-off is that the native binary is tied to the Node ABI, so switching Node majors requires a reinstall (`pnpm install --force`), and published-package users who cannot reach the mirror must set `better_sqlite3_binary_host_mirror` or install build tools. The runtime floor is Node 20.19–25, and the driver replacement point stays in the connection adapter.
- Node 20 compatibility also pins `kysely@0.28.8` (0.29 declares Node >=22) and imports the migrator from the `kysely` main entry. Fastify 5 still pulls `cookie@2`, which declares Node >=22, through `light-my-request`; it is pure JavaScript and the full test suite plus package smoke pass on Node 20, but upstream does not declare Node 20 support.
- Migrations are guarded by a golden checksum and a real v1 fixture upgrade test: a new migration must update the checksum manifest; editing a released migration fails CI, and upgrades keep data and pass backup/restore.
- SQLite does not encrypt data at rest; database file permissions become the only protection, matching the threat model of the old JSON files.
- A test matrix for schema migration, backup/restore, and revision checksums is required; the old atomic-write, JSONL, and tail-recovery tests will be replaced.
- This is an architecture-level change: `docs/architecture.md` is updated in this PR, and implementation is tracked by m14 / issue #79.
