# Polish the README showcase and project introduction

English | [中文](m7-readme-showcase.md)

```yaml flow
kind: issue
milestone: m7
priority: P1
status: done
scope:
  - README*
  - docs/assets/ztask-admin.png
  - scripts/doc-budgets.manifest.json
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m7-project-portal*
  - .agents/flow/issues/m7-readme-showcase*
adr: []
github:
  number: 53
  url: https://github.com/Shadow-Azure/ZTask/issues/53
```

## Background

The README currently contains only a short description and a command list, so new visitors cannot see the product or what problem it solves. It needs a real admin-UI screenshot and a capability overview aimed at newcomers.

## Goals

- Add a real admin-UI screenshot and a one-line value proposition to the top of the README.
- Cover the main capabilities, quick start, and documentation entry points without bloating the front page.
- Mirror the English side and re-record the bilingual pairing, using only fictional demo data in the screenshot.

## Independent verification

```sh
pnpm lint:docs && pnpm verify:docs && pnpm verify:flow
```

## Non-goals

- Do not change product code, page styling, or behavior.
- Do not add external service dependencies.
