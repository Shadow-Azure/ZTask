# Agent Note: Porting doc-engineering gates as independent leaves

Status: implemented

English | [中文](2026-11-02-doc-engineering-port.md)

## Problem

ZTask already had bilingual triplets, budgets, pairing, and Agent Note checks, but the original port kept most gate tests in one handwritten list, so a new script could never enter self-test automatically. Postmortem validation, changed-path routing, independent specs, and wiring self-protection were also missing. Appending more tests to one file would make the gate suite harder to maintain and leave no second check when CI or the command list drifted.

## Decision

Port StudyWiki's generic docs-as-code layer: give every check an independent spec; add `verify-postmortem`, `route-gates`, `gate-coverage`, and `ci-wiring`; make `test:gates` discover every vitest spec under `scripts/`; and compose checks into doc-quick and doc-sync through `run-gates`. CI continues to embed `pnpm test`, `pnpm build`, and `pnpm verify:docs`.

Application-specific gates for environment independence, release, macOS packaging, plugin layering, and command generation do not enter ZTask. The `walkthrough` engineering site remains a separate subsystem and is out of scope.

## Alternatives considered

- Copy the whole StudyWiki repository: it would bring in nonexistent product structure and application-specific gates, rejected.
- Keep one `gates.spec.mjs` and append cases: new scripts could still escape testing and gate coverage would remain unendorsed, rejected.
- Port `walkthrough` at the same time: substantially broader than documentation quality gates and explicitly deferred.

## Consequences

Every new gate must now ship a same-name spec or an explicit coverage mapping, and must update `run-gates`, routing, the AGENTS command list, and relevant documentation; otherwise `gate-coverage` or `ci-wiring` turns red. Splitting the gate tests adds a little vitest startup cost, while improving focused testing, diagnosis, and rule evolution.
