# ZTask web HTML prototype design and alignment

English | [中文](m1-html-prototype.md)

```yaml flow
kind: issue
id: m1-01
milestone: m1
depends: []
priority: P0
status: in-progress
scope:
  - plan/m1-01-ui-prototype/**
  - .agents/flow/issues/m1-html-prototype*
adr: []
github:
  number: 3
  url: https://github.com/Shadow-Azure/ZTask/issues/3
```

## Background

ZTask's final shape follows the overall architecture of DeepSeek Harness: a local CLI service accessed through a web client. Before writing any implementation code, the interface shape must be aligned in the web client; the prototype is the baseline for everything designed afterwards.

## Goals

- Discuss with the user and settle the information architecture and the screen inventory.
- Produce a browsable static HTML prototype covering every screen in the inventory and its key interactions.
- Review and iterate screen by screen until the user explicitly signs off on the prototype.

## Design authority

- Shape blueprint: DeepSeek Harness (local CLI + web GUI, single-page access).
- This issue goes first and has no prior design document; the signed-off prototype is the input to the m1-02 design documents.

## Implementation

- A static prototype under `plan/m1-01-ui-prototype/`: an `index.html` prototype navigation page plus one static HTML page per screen in the inventory (inline CSS/JS is fine; no front-end framework).
- A local static file server serves the prototype for browser review.

## Implementation steps

1. Align the screen inventory and the key elements and interactions of each screen with the user.
2. Build the navigation page, then implement each screen as static HTML.
3. Serve locally, collect feedback screen by screen, and iterate.
4. Get the user's sign-off and archive the prototype directory.

## Dependencies and boundary

- Dependencies: none.
- Delivery boundary: the static prototype and the screen inventory; no build tooling, no framework choice, no real data.

## Verification

```sh
python3 -m http.server 8123 --directory plan/m1-01-ui-prototype
```

- Opening `http://127.0.0.1:8123/` in a browser reaches every screen in the inventory from the navigation page and demonstrates the key interactions.

## Acceptance

- The prototype covers the aligned screen inventory with no missing screens.
- The user has reviewed every screen and explicitly confirmed the final version.
- `pnpm lint:docs` and `pnpm verify:flow` are green.

## Gates and CI

- Markdown inside the prototype directory (if any explanatory files are added) falls under the bilingual triplet and line-wrap gates.
- The existing CI lanes, build-and-docs and flow-online, cover everything.

## Non-goals

- No front-end framework or tooling selection.
- No design documents (that belongs to m1-02).
- No real front-end or back-end logic.
