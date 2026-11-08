# Stage 15: Prototype UI and detailed design

English | [中文](m16-prototype-ui-design.md)

```yaml flow
kind: milestone
id: m16
title: 阶段 15：原型 UI 与详细设计
status: done
github:
  number: 16
  url: https://github.com/Shadow-Azure/ZTask/milestone/16
```

This stage iterates `plan/m1-01-ui-prototype/ztask-prototype.html` against the latest product request, confirming new interactions and visuals in the static prototype before syncing the detailed design and real implementation. The flow id is m16 and reuses the existing GitHub milestone 16 title.

## Delivery boundary

- Each prototype change keeps before/after screenshots of the same scenario and identifies the baseline and changed branch.
- The detailed design is updated after prototype confirmation; real implementation lands in `apps/web` / the server under its own issue.
- Permissions, data protocols, and save semantics follow the confirmed design.

## Stage acceptance

- The prototype covers the interactions and visual changes confirmed in this stage, with before/after captures of the same scenario.
- Confirmed changes are synced to the detailed design and real implementation where applicable.
- `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` are green.
