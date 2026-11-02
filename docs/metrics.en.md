# Metrics

English | [中文](metrics.md)

ZTask is moving from a runnable foundation toward task workflows: any number worth tracking long-term gets registered here with its definition before collection is implemented.

## Defined

- Doc word budgets: counting rules in `scripts/verify-doc-budgets.mjs` (CJK counts per character, the rest per whitespace token, generated regions excluded), registry in `scripts/doc-budgets.manifest.json`.
- Gate exemption ratio: exemption of `ts` fences (`ignore-check`) beyond half turns red, see `scripts/doc-typecheck.mjs`.

## Pending

Once task workflows stabilize, add: timeliness of progress updates, status consistency, and collaboration participation. No collection is built before its definition is registered here.
