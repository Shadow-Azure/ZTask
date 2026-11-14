# Ship the ztask single package with a CI release pipeline

English | [中文](m13-single-package-release.md)

```yaml flow
kind: issue
milestone: m13
priority: P0
status: done
scope:
  - apps/ztask/**
  - apps/cli/**
  - scripts/**
  - tests/**
  - .github/workflows/**
  - .agents/**
  - package.json
  - pnpm-lock.yaml
  - README.md
  - README.en.md
  - README.i18n.yaml
  - docs/architecture.md
  - docs/architecture.en.md
  - docs/architecture.i18n.yaml
  - docs/development.md
  - docs/development.en.md
  - docs/development.i18n.yaml
  - .gitignore
  - reports/**
adr:
  - ../../notes/implemented/process/2026-11-05-single-package-release.md
github:
  number: 77
  url: https://github.com/Shadow-Azure/ZTask/issues/77
```

## Background

The user explicitly asked for single-package delivery first, and it is the active release blocker, so it proceeds as P0. The former P1 conflicted with the already-merged m14 in the same tier and made the completed SQLite migration look locked.

ZTask can currently only run from the repository: installation requires a clone, pnpm, and `pnpm build`; the CLI hard-codes the Web static directory to a monorepo-relative path; the version is duplicated as a commander constant; and there is no release pipeline. The user chose Option A first — single-package publishing — ending with a CI-driven release.

## Goals

- Add a publishable `ztask` package: bundle CLI, server, and shared into one ESM artifact with the prebuilt Web app; include `bin.ztask`, `files`, `engines`, and repository metadata so `npm pack` yields exactly one tarball.
- Make the CLI resolve Web assets in both the packaged layout (next to `dist/cli.js`) and the monorepo layout (`apps/web/dist`); take the version for `--version` and the health check from the packaged `package.json`.
- Add a CI package-install smoke: install the tarball in a clean temporary directory, start it, and assert health plus the SPA page; run it on pull requests and main.
- Add a tag- or manually-triggered release workflow: verify tag and package version match, run tests/build/package smoke, create a GitHub Release with the tarball first, then run `npm publish --provenance` only when `NPM_TOKEN` is configured; skip npm otherwise with a log note.
- Add a single-package install entry to the README, document release steps and required credentials, and record the packaging/release decision in an Agent Note.

## Acceptance

- After `pnpm build`, `npm pack` in `apps/ztask` produces one tarball containing only `dist/` and the package README, not workspace sources.
- In a clean temporary directory, `npm install <tarball>` then `npx ztask --version` equals the package version; `npx ztask serve --port 0 --no-open` starts, `/api/v1/health` returns 200 with the same version, and `/` returns HTML with the Vue entry.
- Inside the monorepo, `node apps/cli/dist/cli.js serve` still loads `apps/web/dist` without regression.
- The CI package smoke passes on pull requests; without `NPM_TOKEN` the release workflow still produces a GitHub Release with the tarball, and a configured token additionally completes the npm publish.
- `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` pass.
