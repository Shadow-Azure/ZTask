# Agent Note: Single-package release with tag-driven CI publishing

Status: implemented

English | [中文](2026-11-05-single-package-release.md)

## Problem

ZTask's install path has always targeted contributors: clone the repository, install pnpm, run `pnpm build`, then start from `apps/cli/dist`. The CLI hard-codes the Web static directory to the monorepo-relative path `../../web/dist`, duplicates the version as a commander constant, and the repository has no release pipeline. Option A requires a non-developer to run ZTask with only Node installed, and asks for publishing to become a reproducible CI process.

## Decision

Add the workspace package `apps/ztask` (published as `ztask`) that uses esbuild to bundle the build outputs of `@ztask/cli`, `@ztask/server`, and `@ztask/shared` into a single ESM entry, keeping third-party dependencies (fastify, @fastify/*, commander) external and resolved from package.json dependencies; copy `apps/web/dist` to the packaged `dist/web`. The CLI's Web directory resolution accepts both "packaged `dist/web`" and "monorepo `apps/web/dist`", and reads the version from the packaged `package.json` so both layouts agree.

Publishing uses two pipelines: the PR/main CI gains a package-install smoke (`npm pack` → install in a clean directory → start → health and SPA assertions); pushing a `v*` tag runs the release workflow, verifies the tag matches the package version, reuses tests, build, and smoke, then runs `npm publish --provenance` and creates a GitHub Release with the tarball. npm credentials come from the repository secret `NPM_TOKEN`; a missing secret fails the publish step explicitly.

## Alternatives considered

- Publish `@ztask/cli` + `@ztask/server` + `@ztask/shared` as multiple packages: the install name and versions must align across three packages, users can still end up with mismatched combinations, and it contradicts the single-package requirement. Rejected.
- Put only the web output inside the CLI package while the server keeps depending on workspace packages: `@ztask/server` would not resolve from npm after publishing, so it is still a multi-package release. Rejected.
- Build the Docker image first: containers solve the runtime but leave the lightest `npx ztask` path unavailable; Option A delivers the single package first and leaves Docker for a later stage. Rejected.
- Compile the three packages into one directory with `tsc` project references: module specifiers are not rewritten, and the in-package layout couples to the source tree. Rejected.

## Consequences

- A release must run `pnpm build` (or let `prepack` trigger the pipeline build) first, otherwise the tarball may lack `dist/`; CI and local smoke both build before packing.
- esbuild becomes a build dependency of `apps/ztask`; raising the Node target requires updating `engines` and the esbuild target together.
- The first public release needs the maintainer to configure `NPM_TOKEN` and confirm the package name and license; until then the tag workflow fails loudly instead of skipping silently.
- The single package makes the npm install size include the Web artifacts; a later Docker image can reuse the same `dist` without business-code changes.
