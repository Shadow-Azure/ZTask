# Architecture

English | [中文](architecture.md)

## Application composition

ZTask is a local-first team progress tool managed as a pnpm workspace with four layers:

- `apps/cli/`: the user entry point; parses `serve` arguments, builds configuration, starts the server, and handles shutdown signals.
- `apps/server/`: the Fastify service, static frontend fallback, data-directory lock, and local JSON/JSONL storage.
- `apps/web/`: the admin shell built with Vue 3, Vue Router, and TanStack Query.
- `packages/shared/`: the cross-surface API prefix, DTOs, and error contract.

`tests/` covers startup, configuration, storage recovery, the web shell, and shared behavior. `plan/fullstack-design/` holds the design and implementation basis.

## Startup and data flow

The CLI parses configuration and calls the server's `serve()`. Startup is fixed to: data-directory single-writer lock → manifest, recovery, and indexes → Fastify assembly and listening. Any failure releases the lock. The service listens only on loopback, and `/api/v1/admin` additionally validates request origin. Unmatched API routes return a uniform JSON 404; other paths fall back to the SPA when static output exists.

The server treats the data directory as its persistence boundary. Tasks, folders, members, revisions, and the manifest are stored separately; recovery and indexes complete before listening. Later requests use the storage facade. The web client calls `/api/v1` through its HTTP layer, while the shared package pins request, response, and error shapes.

## Backup, restore and diagnostics

- Online backup runs inside the live service (`POST /api/v1/admin/maintenance/backup`, local admin only): pause the write queue and wait for in-flight writes, copy the data directory to a temp directory (excluding `locks/`, `tmp/`, `backups/`), validate manifest, JSON, JSONL checksums, revision tips and references, write a report, then atomically publish under `backups/<timestamp>-<uuid>/`.
- `ztask backup` calls that endpoint over loopback; a concurrent backup returns 409.
- `ztask restore --backup <dir> --data-dir <dir>` validates the backup in an independent temp directory and runs `initStore` there before atomically switching to the target; the target must be absent or empty and a failure leaves no half-restored directory.
- `ztask doctor` scans read-only and separates "a restart can auto-fix this" (JSONL trailing partial line) from "restore from backup" (mid-file checksum, current disagreeing with the revision tip, broken references, corrupt manifest).
- Backups are full directory snapshots (including revisions, network.json and auth sessions); they are neither compressed nor pruned.

## Documentation engineering

Documentation is a first-class artifact with three layers:

- `docs/AGENTS.md` defines writing and placement rules, while `docs/README.md` owns the sole document index.
- `docs/i18n/` holds the pairing contract, terminology, and translation prompt; every resident document is a `.md`, `.en.md`, and `.i18n.yaml` triplet.
- `.agents/notes/` records decisions, `.agents/flow/` records the roadmap, milestones, and issues, and `docs/postmortem/` is reserved for incident narratives.

`scripts/` provides composable gates. `run-gates` combines quick and full modes; `route-gates` recommends commands for changed paths; every check has an independent spec. `gate-coverage` reconciles scripts with tests, while `ci-wiring` detects drift among modes, CI, and command lists.

## Technical constraints

- Gate scripts use the Node standard library and the TypeScript compiler API without runtime dependencies.
- Blob hashes, pair records, and structural signatures require LF text, enforced by `.gitattributes`.
- Storage writes pass through the single-writer lock and write queue; recovery completes before HTTP opens.
- The admin API is local-host-only by default; later issues extend LAN access.
