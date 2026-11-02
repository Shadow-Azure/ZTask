# CLI, workspace, and same-origin server bootstrap

English | [中文](m2-app-bootstrap.md)

```yaml flow
kind: issue
milestone: m2
priority: P0
status: done
scope:
  - apps/cli/**
  - apps/server/**
  - apps/web/**
  - packages/shared/**
  - package.json
  - pnpm-workspace.yaml
  - tsconfig*.json
  - tests/bootstrap/**
  - .agents/flow/issues/m2-app-bootstrap*
  - pnpm-lock.yaml
  - .gitignore
  - .github/workflows/ci.yml
adr: []
github:
  number: 12
  url: https://github.com/Shadow-Azure/ZTask/issues/12
```

## Background

The repository currently contains only a prototype and documents. It needs an executable workspace with fixed boundaries for a single process serving same-origin static assets and APIs.

## Goals

- Create pnpm workspace packages for the CLI, server, web, and shared contracts.
- Support development and production startup with one command; production binds only to 127.0.0.1 by default.
- Provide health checks, graceful shutdown, and a configurable data directory while leaving room for LAN admin rejection hooks.

## Design basis

- `plan/fullstack-design/`: 01 §2–3, 03 §1–3, 04 §1–3, and 07 §1.
- `plan/m1-01-ui-prototype/ztask-prototype.html` is the visual and interaction baseline.

## Implementation

- Compose `/api/v1` and the Vue build with Fastify; parse host, port, and data-dir in the CLI.
- Export the API prefix, common errors, and base DTOs from the shared package; configure the Vite build and runtime in web.
- Unknown APIs return the common 404 shape, and static fallbacks must not swallow API errors.

## Steps

1. Write startup and route-fallback tests before creating the workspace and minimal packages.
2. Implement the CLI lifecycle and Fastify plugin composition, then connect the Vite page.
3. Start with an empty data directory and verify restart, occupied-port handling, and non-loopback default rejection.

## Dependencies and delivery boundary

- Baseline: the M1 prototype and design; this issue delivers only the work above, leaving other capabilities to later issues.
- Keep code changes within scope. Define cross-issue contracts in `packages/shared` instead of copying private implementations.

## Independent verification

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

Run workspace type checks, startup integration tests, and the production build. Start via the CLI in a clean data directory and request health plus an unknown `/api/v1` route.

## Acceptance criteria

- A fresh clone can open the admin shell with one command after documented installation.
- The default listener accepts loopback only, and shutdown leaves no child processes or pending writes.
- APIs and static assets share an origin, and API errors never return index.html.

## Gates and CI

- Reference this issue’s GitHub `(#N)` in commit and PR titles; run `pnpm flow:sync` and move to ready before starting.
- Pass `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs` for document-structure changes, and `pnpm verify:flow`; CI also checks PR diff scope and GitHub consistency.
- Record new permission, storage, or architecture decisions in proposed Agent Notes and archive them after completion.

## Non-goals

- Do not implement task, member, or sharing business logic; do not add a desktop shell, Docker, or a multi-process database.
