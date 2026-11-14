# Add ztask init to configure PATH

English | [中文](m13-ztask-init-path.md)

```yaml flow
kind: issue
milestone: m13
priority: P0
status: done
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

- Add a guided `ztask init` subcommand that resolves the npm global prefix and computes the executable directory; when configured it only reminds, otherwise it shows the directory and the target startup file and asks for y/n confirmation before writing the shell startup file (the current user PATH on Windows); `--yes` skips the confirmation, and a successful write prints the `source` and current-session commands.
- Report the directory, the written location, the command that applies it to the current terminal, and a missing ztask shim hint; declining exits 0, while read, confirmation, or write failures exit non-zero.
- Document both startup paths for a missing command in the Chinese and English root READMEs and the package README.
- Cover idempotency, confirmation and decline, startup-file selection, and platform branches with a temp home directory plus injected prefix and confirmation; write an Agent Note for the PATH persistence trade-offs.

## Acceptance

- When PATH lacks the npm global directory, `ztask init` shows the directory and the target startup file and waits for confirmation: `y` writes it into the matching zsh/bash/fish startup file without appending twice on repeat runs, `n` changes nothing, and an already configured directory is only reported; after a write it prints the `source` and current-session commands.
- `--yes` skips the confirmation; a non-interactive environment without `--yes` exits with code 1 and a hint.
- The Windows branch updates the current user PATH and never the system PATH; declining writes nothing.
- Both README languages explain the `npx ztask init` confirmation flow and `--yes`.
- `pnpm build`, `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` pass.
