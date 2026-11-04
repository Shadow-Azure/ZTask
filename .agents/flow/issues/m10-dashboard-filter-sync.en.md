# Preserve dashboard time range when the member filter changes

English | [中文](m10-dashboard-filter-sync.md)

```yaml flow
kind: issue
milestone: m10
priority: P1
status: in-progress
scope:
  - apps/web/**
  - tests/**
  - reports/**
  - .agents/flow/**
adr: []
github:
  number: 68
  url: https://github.com/Shadow-Azure/ZTask/issues/68
```

## Background

The 2026-11-04 smoke test found that after submitting a custom time range on the dashboard, changing the member filter makes the `changes` request fall back from `mode=custom&startDate&endDate` to `mode=default` and resets the date controls to “yesterday to now”, so task progress changes outside the selected range leak into the result. Evidence lives in `reports/2026-11-04/dashboard-member-filter/`.

The root cause is that a member-filter change swaps the `summary` query key; while `summaryQuery.isLoading` is briefly true the whole content area is replaced by `LoadingState`, which unmounts and remounts `ChangesPanel` and resets its local `submitted` range to the default.

## Goals

- Keep the previous `summary` data while the member filter changes so the content area and `ChangesPanel` are not unmounted.
- Keep using the submitted `mode`, `startDate`, and `endDate` when refreshing for a new `memberIds` value.
- Add a component regression test for “change member after a custom range” covering both request and control state; it must fail before the fix and pass after it.
- Re-verify on a real build and real API, and update the smoke report with post-fix evidence.

## Acceptance

- After a custom 2026-11-04 range, selecting Zhou keeps “自定义日期”, keeps the 11-04 controls, and shows the empty state.
- After the same range, selecting Chen still shows only Chen-related A/D, with `mode=custom`, both dates, and `memberIds` in the request.
- After a custom 2026-11-03 range, changing members keeps 11-03 instead of falling back to the default.
- `pnpm test`, `pnpm lint:docs`, and `pnpm verify:flow` pass; the browser smoke has no console errors.
- The smoke report marks the P1 fixed and keeps before/after screenshots.
