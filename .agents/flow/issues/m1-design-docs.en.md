# ZTask full-stack design document suite

English | [中文](m1-design-docs.md)

```yaml flow
kind: issue
id: m1-02
milestone: m1
depends:
  - m1-01
priority: P0
status: in-progress
scope:
  - plan/fullstack-design/**
  - .agents/flow/issues/m1-design-docs*
adr: []
github:
  number: 2
  url: https://github.com/Shadow-Azure/ZTask/issues/2
```

## Background

Once the prototype is signed off, the interface shape must be consolidated into reviewable full-stack design documents — the single basis for planning all later milestones, roadmap items, and issues. The structural reference is the document suite in the harness-evolution repository under `plans/fullstack-design`. The suite actually lands at `plan/fullstack-design/`, same name and same structure as the reference directory; the scope is declared against the actual location, and the reserved `docs/design/` path together with the docs index and word budget registrations is dropped accordingly.

## Goals

- Produce a complete design suite under `plan/fullstack-design/` covering architecture, features, front end, back end, API, and data design.
- Review each document with the user one by one and obtain confirmation.
- Make the suite the direct input for planning the later engineering milestones.

## Design authority

- The signed-off HTML prototype (the m1-01 deliverable) is the single interface baseline.
- The suite structure follows harness-evolution's `plans/fullstack-design`: separate volumes for architecture, features, frontend, backend, api, database, and so on.

## Implementation

- Design document volumes under `plan/fullstack-design/` (Chinese base), organized by that structure, with an overview README; English sides follow the per-volume review.

## Implementation steps

1. Align the volume inventory and the writing order with the user.
2. Write the Chinese side volume by volume against the signed-off prototype.
3. Review, revise, and finalize each volume with the user.
4. Complete the English sides.

## Dependencies and boundary

- Dependencies: m1-01 (prototype sign-off).
- Delivery boundary: the design documents themselves; no implementation code, no concrete planning text for later milestones.

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
- No planning of later milestones and issues (that happens separately once the design documents are confirmed).
