# Stage 17: Prototype UI iteration

English | [中文](m18-prototype-ui-iteration.md)

```yaml flow
kind: milestone
id: m18
title: 阶段 17：原型 UI 迭代
status: active
github:
  number: 19
  url: https://github.com/Shadow-Azure/ZTask/milestone/19
```

This stage continues the prototype iteration mechanism from m16: `plan/m1-01-ui-prototype/ztask-prototype.html` keeps evolving against the latest product requests. Interactions and visuals are confirmed in the static prototype with before/after captures before syncing the detailed design and real implementation.

## Delivery boundary

- Each prototype change keeps before/after screenshots of the same scenario and identifies the baseline and changed branch.
- After user confirmation, the confirmed design is synced to the detailed design; real implementation lands in `apps/web` / the server under its own issue.
- Data protocols and save semantics follow the confirmed design.

## Stage acceptance

- The prototype covers the interactions and visual changes confirmed in this stage, with before/after captures of the same scenario.
- Confirmed changes are synced to the detailed design and real implementation where applicable.
- `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` are green.
