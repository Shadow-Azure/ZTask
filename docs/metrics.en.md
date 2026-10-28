# Metrics (pending)

English | [中文](metrics.md)

ZTask has no product yet; this file reserves the place of metrics engineering: any number worth tracking long-term gets registered here with its definition before any collection is built.

## Defined

- Doc word budgets: counting rules in `scripts/verify-doc-budgets.mjs` (CJK counts per character, the rest per whitespace token, generated regions excluded), registry in `scripts/doc-budgets.manifest.json`.
- Gate exemption ratio: exemption of `ts` fences (`ignore-check`) beyond half turns red, see `scripts/doc-typecheck.mjs`.

## Pending

After launch, the first product capabilities define: timeliness of progress updates, status consistency, collaboration participation. No collection is built before a definition is registered in this file.
