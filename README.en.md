# ZTask

English | [中文](README.md)

ZTask is a local-first team progress management tool. The repository currently includes a runnable CLI, Fastify server, Vue admin client, shared contracts, storage-recovery tests, and documentation and development-flow gates treated as first-class code.

## Quick start

```sh
pnpm install
pnpm install:hooks
pnpm build
pnpm serve
```

During development, `pnpm dev` starts the workspace in parallel. The service listens only on loopback by default and stores data in its configured data directory; see the [development guide](docs/development.en.md) for details.

## Quality gates

- `pnpm lint:docs`: quick documentation gate.
- `pnpm verify:docs`: full documentation gate plus gate self-tests.
- `pnpm test:gates`: all documentation, flow, and gate-script tests.
- `pnpm route:gates`: recommend a gate combination for current changes.
- `pnpm test`: production build, gate tests, and workspace automation tests.

Chinese is the base documentation side; maintain the English side and pair records alongside it under the [bilingual-pairing contract](docs/i18n/README.en.md). Work follows roadmap → milestone → issue as defined in the [development flow](.agents/flow/README.en.md), with decisions recorded in [Agent Notes](.agents/notes/README.en.md).

See the [architecture](docs/architecture.en.md) for module boundaries and the [charter](docs/charter.en.md) for project scope.
