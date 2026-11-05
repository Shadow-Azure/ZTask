# v1 schema fixture

Real `ztask.db` created by the released v1 schema (Kysely migration `0001_initial`,
`user_version=1`) on 2026-11-05, then compacted with `VACUUM INTO`.

Data included: 2 folders, 2 members, 3 main tasks and 1 subtask; the main task
`27175541-1091-4e1e-89e3-832617a36e9e` is at progress 70 / version 2 with 2 revisions.
`schema.sql` is the `sqlite_master` dump for review; `ztask.db` is the binary fixture
used by `tests/storage/upgrade-fixture.spec.ts`.

This is a test fixture, not a smoke/report artifact. Keep this v1 fixture when adding
new migrations; the upgrade test runs the current app against it and asserts data,
checksums, `quick_check` / `foreign_key_check`, and backup/restore.
