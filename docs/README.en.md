# Documentation Index and Maintenance

English | [中文](README.md)

ZTask treats documentation as a first-class artifact: every consistency requirement that can be mechanized gets a failing gate, leaving choices, translation judgment, and archival to people. In-scope documents use Chinese/English triplets.

## Document map

| Document | Responsibility |
|---|---|
| [AGENTS.md](AGENTS.md) | Documentation rules and gate summary (monolingual exemption) |
| [charter.md](charter.en.md) | Vision and boundaries |
| [architecture.md](architecture.en.md) | Current repository composition, technical boundaries, and doc engineering |
| [development.md](development.en.md) | Environment, development loop, hooks, and CI |
| [metrics.md](metrics.en.md) | Metric definitions |
| [review.md](review.en.md) | Review and acceptance rules |
| [postmortem/README.md](postmortem/README.en.md) | Incident-review contract |
| [i18n/README.md](i18n/README.en.md) | Bilingual pairing contract |
| [i18n/terminology.md](i18n/terminology.en.md) | Terminology and banned alternates |
| [i18n/translation-prompt.md](i18n/translation-prompt.en.md) | Operational template for the English side |

The flow tree lives in [.agents/flow/README.md](../.agents/flow/README.en.md), and decision records live in [.agents/notes/README.md](../.agents/notes/README.en.md).

## Mechanical surface

- Dedicated gates check the index, word budgets, paragraph wrapping, postmortem structure, and Agent Note state.
- Pair records store both blob hashes and validate switchers, link locales, fences, and structural mirroring.
- Dead links and anchors, TypeScript fence compilation, type-equivalence declarations, exported TS JSDoc, and source references to docs each have an independent leaf.
- `route:gates` recommends a gate combination for changed paths; `test:gates` automatically runs every gate spec under `scripts/`.

## Maintenance loop

Rule injection → decision record → current-state documentation → bilingual pairing → local quick gate → CI full decision → postmortem. `pnpm lint:docs` is the pre-commit quick path; `pnpm verify:docs` is the full path used by CI.
