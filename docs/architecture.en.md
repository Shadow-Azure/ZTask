# Architecture (initial stage)

English | [中文](architecture.md)

## Shape

The initial stage is a single repository on one Node toolchain (pnpm) with no product code. The repository currently consists of three parts:

- `docs/`: resident documentation (bilingual triplets with gates).
- `.agents/`: the Agent Note system and the development flow rules (flow tree not initialized).
- `scripts/`: gate scripts and flow tooling (plain Node, no build step).

## Technical constraints

- Gate scripts use only the Node standard library plus the typescript compiler API; no runtime dependencies. devDependencies hold only typescript and @redocly/ajv (used by the gate self tests).
- Byte-level doc gates (blob hash, pairing records) require a uniform LF text shape, enforced via `.gitattributes`.
- Product technology choices are undecided; when choosing, edit this file first, then write code.

## Direction

The first batch of product capabilities is expected to form around progress modeling; module boundaries, data flow and interface contracts sections will follow then, with executable constraints sunk into new gates.
