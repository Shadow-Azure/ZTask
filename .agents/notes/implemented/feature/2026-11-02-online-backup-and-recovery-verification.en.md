# Agent Note: Online Backup Consistency, Restore Validation and Doctor Classification

Status: implemented

English | [中文](2026-11-02-online-backup-and-recovery-verification.md)

## Problem

Before the first release we must prove that "a backup taken while running never mixes files from different points in time", "restore never pollutes the real data directory", and "diagnostics never silently repair corruption that cannot be explained". [06](../../../../plan/fullstack-design/06-database-design.md) §10 and [07](../../../../plan/fullstack-design/07-backend-implementation.md) §9 settle pausing the write queue, validating in a temp directory, atomic publishing and a read-only doctor, but leave open the trigger, the backup layout, cleanup on failure, and how doctor classifies issues. Those decide whether a backup is a deliverable and whether a failed restore leaves a half state.

## Decision

- **The running service performs the backup**: only the process holding the write queue can guarantee consistency, so `POST /api/v1/admin/maintenance/backup` is exposed behind the existing Admin local-only guard (LAN → 403). The CLI `ztask backup` calls that endpoint over loopback instead of stealing the data-directory lock. A concurrent backup returns 409 `BACKUP_IN_PROGRESS`.
- **Snapshot flow**: `pauseWrites()` (block new mutations, wait for in-flight queue work) → copy the data directory to `tmp/backup-*` (excluding `locks/`, `tmp/`, `backups/`) → validate manifest, JSON parsing, JSONL checksums and revision tips, and reference integrity → write a `backup.json` report → `rename` to `backups/<UTC timestamp>-<uuid>/` atomically → release the queue. Any failure cleans the temp directory and resumes writes.
- **Backup report**: format version, application version, creation time, team timezone, file/byte counts, validation result and issue list; `backup.json` travels with the data so restore and diagnostics can re-check it.
- **Restore never overwrites in place**: `restoreFromBackup` fully validates the backup, copies it to a temp directory next to the target, runs `initStore` against that temp directory (manifest/recovery/index), and only then renames it to the target. The target must be absent or empty; a failure leaves no half-restored directory.
- **Doctor is read-only and classified**: `doctor(dataDir)` only scans; issues are either `fixable` (a JSONL trailing partial line, or current lagging the revision tip that startup recovery rebuilds) or require a backup (current ahead of the tip or with a mismatched checksum, mid-file checksum, broken references, corrupt manifest/network, malformed shapes). `validate.ok` means "no blocking issues"; an auto-fixable snapshot can still be backed up and restored, with all `issues` reported. The CLI exits 1 on findings so a new user can tell "restart fixes it" from "restore from backup".
- **Backups carry all business state**: manifest, task aggregates and revisions, folders/members, network.json and auth sessions are copied together, so session policy and share links stay consistent with the data; lock and temp files are excluded.

## Alternatives considered

- Stopping the service and copying the directory as the "online" backup: turns an online operation into downtime and still cannot guarantee no writes during the copy — rejected.
- Letting the CLI grab the data-directory lock to back up: fails while the service runs, so it cannot be online — rejected.
- Restoring by unpacking/overwriting the real directory: a mid-way failure leaves a mixed state with no rollback — rejected.
- Having doctor auto-repair mid-file checksums: disguises unexplainable corruption as fixed, contradicting 06 §8.3's refusal to repair silently — rejected.
- Backing up only current state without revisions: history/diff would be lost, violating the "history consistent" acceptance — rejected.

## Consequences

- Backups are full directory snapshots and grow with history; this version neither compresses nor prunes old backups, leaving that to the user.
- Mutations briefly queue during a backup and HTTP requests may slow down; clients retry on timeout and no write is dropped.
- A restored service keeps the sessions and share links stored in the backup (still valid until expiry); "restore implies revoke" would need a separate security policy.
- Doctor only reports; the "auto-fixable" verdict must be confirmed after an actual restart repair and never replaces a backup.
- Known boundary: only the task write queue is paused; entity files (members/folders/network/session) are outside the gate, so a backup can pair a task snapshot with slightly newer entity files.
