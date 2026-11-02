# ZTask full-stack design document suite

English | [中文](m1-design-docs.md)

```yaml flow
kind: issue
milestone: m1
priority: P0
status: done
scope:
  - plan/fullstack-design/**
  - .agents/flow/**
  - .agents/skills/**
  - .agents/notes/implemented/process/2026-11-01-engineering-flow-tree*
  - scripts/flow-*
  - scripts/verify-flow*
  - scripts/run-gates.mjs
  - scripts/gates.spec.mjs
  - scripts/spec-fixture.mjs
  - scripts/doc-budgets.manifest.json
  - pnpm-lock.yaml
  - AGENTS.md
  - package.json
  - .agents/flow/issues/m1-design-docs*
adr:
  - ../../notes/implemented/process/2026-11-01-engineering-flow-tree.md
github:
  number: 2
  url: https://github.com/Shadow-Azure/ZTask/issues/2
```

## Background

Once the prototype is signed off, the interface shape must be consolidated into reviewable full-stack design documents — the single basis for planning all later milestones, roadmap items, and issues. The structural reference is the document suite in the harness-evolution repository under `plans/fullstack-design`. The suite actually lands at `plan/fullstack-design/`, same name and same structure as the reference directory; the scope is declared against the actual location, and the reserved `docs/design/` path together with the docs index and word budget registrations is dropped accordingly.

## Goals

- Produce a complete design suite under `plan/fullstack-design/` covering architecture, features, front end, back end, API, and data design.
- Review each document with the user one by one and obtain confirmation.
- Split the engineering roadmap, milestones, and issues from the suite, and synchronize flow gates and project skills.

## Design authority

- The signed-off HTML prototype (the m1-01 deliverable) is the single interface baseline.
- The suite structure follows harness-evolution's `plans/fullstack-design`: separate volumes for architecture, features, frontend, backend, api, database, and so on.

## Implementation

- Design document volumes under `plan/fullstack-design/` (Chinese base), organized by that structure, with an overview README; English sides follow the per-volume review.
- The M2–M5 engineering flow tree under `.agents/flow/`, plus StudyWiki-compatible flow gates, gate tests, and `.agents/skills/`.

## Implementation steps

1. Align the volume inventory and the writing order with the user.
2. Write the Chinese side volume by volume against the signed-off prototype.
3. Review, revise, and finalize each volume with the user.
4. Complete the English sides.
5. Split the engineering flow tree, copy flow tooling and skills, and run gate verification.

## Dependencies and boundary

- Dependencies: m1-01 (prototype sign-off).
- Delivery boundary: design documents, the engineering flow tree, and flow tooling; no product frontend or backend implementation.

## Verification

```sh
pnpm verify:docs && pnpm verify:flow
```

- Both commands are green; every volume under `plan/fullstack-design/` passes the current documentation gates.

## Acceptance

- The volumes cover the structure above with nothing missing.
- The user has reviewed each volume and explicitly confirmed it.
- The suite passes every documentation gate and the flow gates.

## Gates and CI

- The volumes fall under the current documentation gates (line wrap, dead links, terminology); once the English sides land, the bilingual triplet contract applies.
- The CI build-and-docs lane is the online execution of the acceptance command.

## Non-goals

- No implementation code.
- Do not implement the product features planned for M2–M5 or synchronize remote GitHub objects in this delivery.
