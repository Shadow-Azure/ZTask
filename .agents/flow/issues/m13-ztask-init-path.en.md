# Add ztask init to configure PATH

English | [中文](m13-ztask-init-path.md)

```yaml flow
kind: issue
milestone: m13
priority: P0
status: in-progress
scope:
  - apps/cli/**
  - tests/**
  - README.md
  - README.en.md
  - README.i18n.yaml
  - apps/ztask/README.md
  - scripts/doc-budgets.manifest.json
  - .agents/flow/issues/m13-ztask-init-path*
  - .agents/notes/**
adr:
  - ../../notes/implemented/feature/2026-11-07-ztask-init-path.md
github:
  number: 86
  url: https://github.com/Shadow-Azure/ZTask/issues/86
```

## Background

After `npm install -g`, `ztask serve` reports that the command is not found when npm's global executable directory is missing from PATH. The user asked for a one-time `npx ztask init` that writes that directory into the shell startup configuration so `ztask serve` works directly; the README should also explain that a missing command can be worked around with `npx ztask serve` or by running `npx ztask init` first.

## Goals

- Add a `ztask init` subcommand that resolves the npm global prefix, computes the executable directory, exits idempotently when it is already on PATH or recorded in the startup file, and otherwise writes the shell startup file (the current user PATH on Windows).
- Report the written location, the command that applies it to the current terminal, and a missing ztask shim hint; exit non-zero on failure.
- Document both startup paths for a missing command in the Chinese and English root READMEs and the package README.
- Cover idempotency, startup-file selection, and platform branches with a temp home directory and an injected prefix; write an Agent Note for the PATH persistence trade-offs.

## Acceptance

- When PATH lacks the npm global directory, `ztask init` writes it into the matching zsh/bash/fish startup file without appending twice on repeat runs; it changes nothing when the directory is already present.
- The Windows branch updates the current user PATH and never the system PATH; an unreadable npm prefix exits with code 1.
- Both README languages explain `npx ztask init` and `npx ztask serve`.
- `pnpm build`, `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` pass.
