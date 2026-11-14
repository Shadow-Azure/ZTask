# Optional plan description in task modal, visible on the main page

English | [中文](m18-01-task-plan-field.md)

```yaml flow
kind: issue
milestone: m18
priority: P1
status: backlog
scope:
  - plan/**
  - .agents/**
  - reports/**
adr: []
github:
  number: 109
  url: https://github.com/Shadow-Azure/ZTask/issues/109
```

## Background

2026-11-14 user feedback: the task edit modal only has the task description and progress detail — there is no place to write an implementation plan. Add an optional "plan description" field, and once filled, show it on the task card in the main page. The change lands in the static prototype first with before/after captures of the same scenario, and the real frontend work starts after user confirmation.

## Goals

- Add a "plan description" block to the task edit modal: multi-line text, optional; leaving it empty does not affect saving or validation.
- Add a `plan` field to the task model, saved automatically together with the task.
- Show the plan on the main page (task card in the tracker) next to the progress detail: filled plans render their text, empty ones show a placeholder.
- Prototype and screenshots first: before/after captures go into the issue and PR; `apps/web` implementation follows user confirmation.

## Acceptance

- The plan description can be saved empty, filled in, and autosaved; reopening the modal keeps the content.
- The task card shows the filled plan; an empty plan shows clear empty-state copy.
- Before/after screenshots of the same scenario live in `plan/m1-01-ui-prototype/review/` and are referenced in the issue/PR.

## Prototype screenshots (2026-11-14, baseline main)

- Main-page task card · before: [100-before-plan-field-card.png](../../plan/m1-01-ui-prototype/review/100-before-plan-field-card.png); after: [101-after-plan-field-card.png](../../plan/m1-01-ui-prototype/review/101-after-plan-field-card.png). A "plan" block is added above the progress detail: filled plans render their text, empty ones show the "未填写方案（选填）" empty state.
- Task edit modal · before: [102-before-plan-field-modal.png](../../plan/m1-01-ui-prototype/review/102-before-plan-field-modal.png); after: [103-after-plan-field-modal.png](../../plan/m1-01-ui-prototype/review/103-after-plan-field-modal.png). An optional "plan description" multi-line input is added under the progress slider.
