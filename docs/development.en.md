# Development Guide

English | [中文](development.md)

## Environment

- Node 20.19–25 (Node 22.x requires 22.12+) and pnpm (v10); versions are pinned by `engines` and `packageManager`. Tests run on CI with Node 22.
- On the first clone, run `pnpm install && pnpm install:hooks`. The installer also registers the fail-closed merge driver for `.i18n.yaml`.
- Documentation and flow gates run offline; online flow verification requires an authenticated `gh`.

## Daily loop

```sh
pnpm route:gates
pnpm lint:docs
pnpm verify:docs
```

`route:gates` reads changed paths and recommends a combination. Documentation-only edits usually need `lint:docs`; changes to document structure, dead links, or fences need `verify:docs`. Gate-script changes also require `pnpm test:gates`; product code follows its workspace tests and `pnpm build`.

When adding or revising a non-trivial decision, write an Agent Note in the same PR. When editing either side of a bilingual pair, minimally patch the other side and run:

```sh
pnpm record:i18n -- docs/foo.md
```

The pair record confirms that both sides agree; review both diffs before recording it. See the contract in [i18n/README.md](i18n/README.en.md).

## Backup, restore and diagnostics

```sh
pnpm serve
node apps/cli/dist/cli.js backup
node apps/cli/dist/cli.js doctor
node apps/cli/dist/cli.js restore --backup <backup-dir> --data-dir <data-dir>
```

`restore` requires the service to be stopped and the target directory to be absent or empty; after restoring, start with the same `--data-dir`. New users should run `serve` first so the directory exists; backups live under `<data-dir>/backups/`.

## Local hooks

`pnpm install:hooks` installs three narrow hooks:

- `pre-commit` rejects trailing whitespace in staged text.
- `commit-msg` requires a flow issue reference `(#N)` in the commit title.
- `pre-push` runs the quick documentation gate.

Hooks provide timely feedback; CI still owns exhaustive coverage.

## Single-package release

`apps/ztask` is the published `ztask` package. After `pnpm build`, `pnpm package:smoke` installs it outside the repository. Push a `v<version>` tag matching the package version, or dispatch `Release`: it creates a GitHub Release with the tarball first, and publishes to npm only when `NPM_TOKEN` is configured, skipping npm otherwise; configuring the token later and rerunning the same version fills in the npm publish. Confirm the package name and license before the first release. Install a Release tarball with `npm install -g <url>`; use `pnpm pack:ztask` to pack locally only.

## Flow and CI

Record each requirement in the roadmap, milestone, and issue tree under `.agents/flow/` before work starts; see [.agents/flow/README.md](../.agents/flow/README.en.md). Generate a new issue with `pnpm flow:new-issue`; backfill its number with `pnpm flow:sync`. Flow gates reconcile commit and PR titles plus scope.

The static CI lane runs `pnpm test`, `pnpm build`, and `pnpm verify:docs`, with an additional flow diff check on PRs. The online lane runs `verify-flow-online`; it validates GitHub state without writing to the remote.
