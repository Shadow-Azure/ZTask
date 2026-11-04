# Stage 10: Dashboard filter linkage fix

English | [中文](m10-dashboard-filter-sync.md)

```yaml flow
kind: milestone
id: m10
title: 阶段 10：看板筛选联动修复
status: active
github:
  number: 10
  url: https://github.com/Shadow-Azure/ZTask/milestone/10
```

Smoke testing found that the dashboard resets a submitted custom range when the member filter changes. This stage fixes the linkage and adds page-level regression coverage.

## Delivery boundary

- Only the dashboard's frontend query lifecycle and regression tests change; statistics, history APIs, and server filtering stay unchanged.
- Preserve the submitted custom range and date controls; refresh within the selected range when members change.
- The smoke report records before/after evidence.

## Stage acceptance

- After a custom range, toggling a member keeps the custom status and date controls, and requests keep `mode`, both dates, and `memberIds`.
- Zhou shows the empty state for today; Chen shows only Chen-related changes.
- The regression test fails before the fix and passes after it; related tests are green.
- Real-browser verification passes and the report marks the P1 fixed.
