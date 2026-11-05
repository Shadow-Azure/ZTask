<div align="center">

# ZTask

**A local-first progress tracker for teams**

One shared answer to “where are we now, who owns it, and what comes next.”

English | [中文](README.md)

[![CI](https://github.com/Shadow-Azure/ZTask/actions/workflows/ci.yml/badge.svg)](https://github.com/Shadow-Azure/ZTask/actions/workflows/ci.yml)

</div>

![ZTask admin UI: folders, tasks, subtasks, progress, and updates](docs/assets/ztask-admin.png)

ZTask keeps team progress in the team's own hands. A single command starts a local service; the admin UI runs in the browser, where goals, owners, and due dates are organized by folder. When collaboration is needed, turn on LAN sharing so each member sees only the work relevant to them. Data lives in a local SQLite database, with dedicated commands for backup, restore, and diagnostics.

## What it does

- **Task tree and progress detail**: folders, main tasks, and one level of subtasks; owners, collaborators, importance, due date, and running notes live on the same card.
- **Dashboard and history diffs**: roll up by completion, importance, and expected finish date, filtered by member; restore before/after snapshots for any time range and compare them side by side.
- **Members and LAN sharing**: one link per person; owners can update their own work while collaborators stay read-only; links can be reset or revoked, and old sessions expire immediately.
- **Backup, restore, and diagnostics**: a single-writer file store and write queue keep state consistent; `ztask backup` takes an online snapshot, `restore` validates before an atomic switch, and `doctor` separates fixable issues from backup recovery.
- **Docs and gates as first-class code**: bilingual doc triplets, dead links, type equivalence, and the development flow are all checked mechanically in CI rather than by convention.

## Quick start

```sh
pnpm install
pnpm install:hooks
pnpm build
pnpm serve
```

Node 22.13+ and pnpm@10 are required. The admin UI is at `http://127.0.0.1:8123` by default and data lives in `~/.ztask` unless `--data-dir` is set; `pnpm dev` starts the workspace in parallel. See the [development guide](docs/development.en.md) for setup and the everyday loop.

## Documentation

- [Documentation index](docs/README.en.md): the entry point to all resident docs.
- [Architecture](docs/architecture.en.md): applications, startup order, and data flow.
- [Charter](docs/charter.en.md): vision and product boundaries.
- [Development flow](.agents/flow/README.en.md): how roadmap → milestone → issue works.
- [Agent Notes](.agents/notes/README.en.md): how non-trivial decisions are recorded.
