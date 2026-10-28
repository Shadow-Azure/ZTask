# Review rules

English | [中文](review.md)

## What review looks at

- All gates green is the floor, not the goal: `pnpm verify:docs` only proves the mechanical rules passed; semantics (definition drift, boundary expansion, terminology misuse) belong to humans.
- Doc changes: both sides in sync, index and budget registered, new terms entered the table first.
- Gate script changes: rules and docs updated on both sides (a rule change must also touch `docs/AGENTS.md` and other semantic sources), self tests covering the new branches.
- Flow-related changes: while the flow tree is uninitialized, no roadmap/milestone/issue content may be introduced.

## How review works

- Small PRs: one PR, one semantic change; the title states what was done.
- Reviewers read the PR template's trade-offs section before the diff; for docs they check registration, for scripts they check that bypass paths are closed.
- Contested trade-offs become an Agent Note referenced from the PR, not comment threads.

## Acceptance

- Every checklist item of the PR template is honored; steps needing manual acceptance ship with an executable command and expected output in the PR description.
