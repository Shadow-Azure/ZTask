# Smoke regression fixes and v2 verification

English | [中文](m6-smoke-regression-fixes.md)

```yaml flow
kind: issue
milestone: m6
priority: P2
status: done
scope:
  - .agents/flow/**
  - apps/server/**
  - apps/web/**
  - tests/**
  - .agents/notes/**
  - plan/fullstack-design/**
  - reports/**
adr: []
github:
  number: 59
  url: https://github.com/Shadow-Azure/ZTask/issues/59
```

## Background

The pre-release full-feature GUI smoke test found three P1 defects: subtask drafts were dropped while creating a task, the confirmation overlay stayed visible after a successful delete, and reopening LAN after closing reused the old port. The defects span task aggregation APIs, editor lifecycle, and network sharing forms, so they need one closed-loop fix plus automated and v2 GUI regression coverage.

## Goals

- Fix the persistence path for subtask drafts when creating a task and add API and component guards.
- Fix confirmation overlay and editor state lifecycle after a successful delete.
- Restore the LAN form port to the actual loopback port after closing sharing.
- Capture first-round failure evidence, fix notes, and the v2 full-feature smoke report.

## Acceptance

- `pnpm lint:docs` and PR CI pass.
- Automated tests cover subtask creation, confirmation overlay teardown, and LAN port restoration.
- The v2 smoke report confirms all 27 scenarios pass and none of the three first-round P1 defects recur.
