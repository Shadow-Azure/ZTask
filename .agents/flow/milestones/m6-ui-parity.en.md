# Stage 6: Screen-by-screen parity with the prototype

English | [中文](m6-ui-parity.md)

```yaml flow
kind: milestone
id: m6
title: 阶段 6：界面与原型逐屏对齐
status: active
github:
  number: 7
  url: https://github.com/Shadow-Azure/ZTask/milestone/7
```

Use `plan/m1-01-ui-prototype/ztask-prototype.html` as the single UI baseline, align the admin and member surfaces screen by screen, and keep the difference evidence and rulings on record.

## Delivery boundary

- Restrict the work to parity fixes plus the necessary contract and test sync; add no features beyond the prototype.
- Compare visuals and interactions against the prototype value by value; never trade security or data boundaries for parity (for example, the redacted share-link presentation).

## Stage acceptance

- Screen-by-screen comparison finds no actionable difference, or every difference carries a recorded ruling and reason.
- Unit tests, builds, docs, and CI gates are green, and the key UI scenarios are repeatably verified against the prototype.
