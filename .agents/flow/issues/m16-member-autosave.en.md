# Member page saves with one per-task button and auto-save

English | [中文](m16-member-autosave.md)

```yaml flow
kind: issue
milestone: m16
priority: P2
status: in-progress
scope:
  - apps/web/**
  - tests/**
  - plan/**
  - .agents/**
  - reports/**
  - scripts/**
adr:
  - ../../notes/implemented/feature/2026-11-08-member-auto-save.md
github:
  number: 95
  url: https://github.com/Shadow-Azure/ZTask/issues/95
```

## Background

On 2026-11-08 a user reported that the member personal page made it unclear which of the two buttons, “保存进度” or “保存详情”, to press when only the detail changed. The user confirmed replacing the two buttons with one per-task “保存”, idle auto-save, and a page-wide Ctrl+S. The prototype and before/after captures were confirmed by the user.

## Goals

- Keep one “保存” per owner task card; one action submits that task's progress and full detail. The endpoints stay separate and are submitted serially as progress → detail, with detail using the new version returned by progress.
- Auto-save after 2 seconds idle; the member home page saves every owner card on Ctrl/⌘+S; show inline save state and time.
- Keep the existing 409 draft-preservation and refresh prompt; the subtask editor keeps its own save button; respect the member-view “all team tasks visible, owner-only edits” boundary.
- Sync the detailed design docs and Agent Note; the prototype continues to be iterated by concurrent UI PRs.

## Acceptance

- Progress-only, detail-only, and progress+detail saves all succeed; the detail request carries the correct version.
- Auto-save and page-wide Ctrl+S are covered by automated tests and real share-page smoke evidence.
- Before/after captures are in the PR description, and collaboration/other-member cards stay read-only.
