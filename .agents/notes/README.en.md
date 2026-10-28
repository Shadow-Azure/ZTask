# Agent Note system

English | [中文](README.md)

An Agent Note is a one-page record of a non-trivial implementation decision: whoever digs into this code later learns "why it was settled this way and what was rejected". The rules are a closed set, mirrored with `scripts/verify-agent-notes.mjs`.

## Path state machine

The path must be `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-<topic>.md`; all three segments are mandatory.

- lifecycle (closed set): `proposed` / `implemented` / `rejected` / `archived`. Transitions are directory moves: an accepted `proposed` moves to `implemented`, a rejected one to `rejected` (Status carries a one-line reason), a stale one to `archived`.
- class (closed set): `feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`.
- Archiving goes through `pnpm archive:note`: move + Status rewrite + sha256 into `archived/manifest.json` (append-only; frozen files are immutable, governed by `verify-archived-agent-notes`).

## File format

- First line: `# Agent Note: <title>`; third line: `Status: <lifecycle>` (rejected is the exception: `rejected — <reason>`).
- The body skeleton is four headings, verbatim and in order: `## Problem`, `## Decision`, `## Alternatives considered`, `## Consequences`. Free sections may only sit between skeleton sections; no second-level heading may follow `Consequences`.
- Bilingual: notes are triplets too, following the docs/i18n contract; skeleton section names are pinned on both sides independently.
- Cross-reference links must resolve and anchors must exist (checked directly by the gate).

## Relation to the flow

Notes are written as usual while the flow tree is uninitialized; once initialized, the design-authority section of an issue references the relevant notes.
