# Harden documentation engineering and gate self-protection

English | [中文](m3-doc-engineering-gates.md)

```yaml flow
kind: issue
milestone: m3
priority: P0
status: in-progress
scope:
  - AGENTS.md
  - README*
  - docs/**
  - .agents/flow/README*
  - .agents/flow/issues/m3-doc-engineering-gates*
  - .agents/notes/**
  - package.json
  - scripts/**
adr:
  - ../../notes/implemented/process/2026-11-02-doc-engineering-port.md
github:
  number: 34
  url: https://github.com/Shadow-Azure/ZTask/issues/34
```

## Background

The existing documentation gates cover bilingual triplets, budgets, pairing, type equivalence, and source references, but their tests still live in an old handwritten list. Postmortems, changed-path routing, gate-coverage checks, and CI wiring self-protection are missing. A new gate may lack a spec, while modes, command lists, or CI can drift unnoticed.

## Goals

- Split generic docs-as-code gates into independent leaves and specs, excluding `walkthrough` and application-specific gates.
- Add postmortems, changed-path routing, gate coverage, and wiring self-protection; make `test:gates` discover every vitest spec automatically.
- Synchronize documentation rules, resident docs, the command list, and the Agent Note for this migration.

## Acceptance

- `pnpm lint:docs`, `pnpm verify:docs`, `pnpm test:gates`, `pnpm verify:flow`, and `pnpm test` all pass.
- Every gate script has a same-name spec or an explicit `gate-coverage` mapping.
- `ci-wiring` reconciles the static CI lane, gate modes, and AGENTS command list.
