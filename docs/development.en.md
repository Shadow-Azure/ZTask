# Development

English | [中文](development.md)

## Environment

- Node 22 + pnpm (version pinned by the `packageManager` field). After `pnpm install`, run `pnpm install:hooks` to install git hooks and the `.i18n.yaml` merge driver.
- No database, no external services; every local gate runs offline.

## Common commands

| Command | Purpose |
| --- | --- |
| `pnpm lint:docs` | Quick doc gates (seconds; run before every commit) |
| `pnpm verify:docs` | Full doc gates (dead links, ts fence compilation, gate self tests) |
| `pnpm verify:flow` | Development flow gate (auto-skipped while the flow tree is uninitialized) |
| `pnpm test:gates` | Gate self tests |
| `pnpm record:i18n -- <pair>` | Re-record the pairing record after editing both sides |

## Branches and commits

- Branch names: a `feat/`, `fix/`, `docs/` prefix plus a dashed topic.
- Commit titles use conventional prefixes (`docs:`, `chore(gates):`, `ci:`, ...); once the flow tree is initialized, titles must carry an issue reference `(#N)` — today it is only a local reminder, not a blocker.
- The pre-push hook runs the quick mode; exhaustive coverage belongs to CI.

## CI

- Static lane: `pnpm test:gates`, `pnpm verify:docs`, and on PRs `node scripts/verify-flow.mjs --diff origin/<base>` (skipped when the base has no flow tree).
- Online lane (PRs): `verify-flow-online.mjs` checks that the flow tree and GitHub agree; requires `GH_TOKEN`.
