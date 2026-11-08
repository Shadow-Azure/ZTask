# Agent Note: Persist the npm global PATH with ztask init

Status: implemented

English | [中文](2026-11-07-ztask-init-path.md)

## Problem

`npm install -g ztask` puts the executable shim into npm's global directory (`<prefix>/bin` on POSIX, the prefix itself on Windows). Many environments do not add that directory to PATH, so the install succeeds but `ztask serve` reports that the command is not found. The user needs a one-time command that writes the directory into PATH; a child process cannot change the parent shell's environment, so the change has to be persisted in configuration.

## Decision

Add `ztask init`: resolve the global prefix with `npm prefix --global` and compute the executable directory; exit successfully when the directory is already on PATH. On POSIX, pick the startup file from `$SHELL` (zsh → `~/.zshrc`, bash → `~/.bashrc`, fish → `~/.config/fish/config.fish`, anything else → `~/.profile`), append a PATH block marked with `# ztask init`, and print the `source`/`fish_add_path` command for the current terminal; on Windows, read and update the current user PATH with PowerShell. Skip the write when the configuration or PATH already contains the directory; npx and npm run prepend their own bin directories to the child PATH, so those invocations do not use PATH to skip persistence and check the startup file instead. When the global directory has no ztask shim, prompt the user to run `npm install -g ztask` first.

## Alternatives considered

- Only print `export PATH=...` for the user to paste: the smallest change, but the user explicitly asked for "run this command and the path is added"; the manual step is error-prone and not persistent, so rejected.
- Symlink into an existing PATH directory such as `/usr/local/bin`: usually needs sudo and conflicts with multi-Node setups such as nvm or Volta, so rejected.
- Update the Windows environment variable with `setx PATH`: truncates long PATH values and may write the merged system and user variables back into the user scope, so rejected; PowerShell updates only the user scope instead.
- Make init re-run `npm install -g`: it does not fix the PATH root cause and adds network and duplicate-install risk, so rejected.

## Consequences

- init persistently modifies the user's shell startup file or Windows user PATH; it only appends a marked block, repeat runs are idempotent, and the user can remove it.
- The startup file is inferred from `$SHELL`; unusual shells need the printed manual guidance, and an already open terminal must be reopened or sourced before the change applies.
- When ztask only runs through npx and is not installed globally, init only prompts for the install and never installs automatically, so the user's global packages stay untouched.
- The Windows branch depends on PowerShell; on failure it prints manual guidance and exits non-zero.
