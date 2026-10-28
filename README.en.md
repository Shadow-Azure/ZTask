# ZTask

English | [中文](README.md)

ZTask is a team progress management tool. The project is at an early stage: see the [charter](docs/charter.en.md) for vision and boundaries. The current engineering focus is the documentation system and the development flow gates; product feature planning comes later.

## Conventions and gates

- Resident docs are bilingual (triplet: `X.md` + `X.en.md` + `X.i18n.yaml`); the contract lives in [docs/i18n/README.en.md](docs/i18n/README.en.md).
- The development flow (roadmap → milestone → issue) rules live in [.agents/flow/README.en.md](.agents/flow/README.en.md); the flow tree is not initialized yet.
- Doc gates: `pnpm verify:docs` (full) / `pnpm lint:docs` (quick).
- Flow gate: `pnpm verify:flow` (auto-skipped while the flow tree is uninitialized).
- Gate self tests: `pnpm test:gates`.

After the first clone, run `pnpm install && pnpm install:hooks` to install local hooks and the i18n merge driver.
