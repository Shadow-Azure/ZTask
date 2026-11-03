# Agent Note: Smoke fixes for atomic creation and dialog lifecycle

Status: implemented

English | [中文](2026-11-03-smoke-create-dialog-network-fixes.md)

## Problem

Real GUI smoke testing found three regressions: subtasks collected by the new-task dialog were silently dropped from the POST; a successful task deletion left its confirmation dialog blocking the dashboard; and, when the network panel had initialized while sharing was running, closing and reopening LAN sharing reused the old LAN port instead of the service's actual loopback port. The first loses user input; the latter two present wrong UI and addressing facts after successful actions.

## Decision

The main-task creation API accepts an optional `subtasks.create` intent and validates fields, owners, and one-level nesting during one aggregate write; any invalid subtask prevents the entire creation. The new-task dialog now submits subtask drafts with the parent. A successful delete mutation resets confirmation state before closing the editor. A successful LAN disable explicitly resets the port form from the current `loopbackUrl` instead of relying on a watcher that does not fire when that URL is unchanged.

## Alternatives considered

Creating the parent first and then each subtask was rejected because it is not atomic and can leave partial results after a later failure. Disabling subtask entry in the new dialog was rejected because the interaction prototype and user expectation require one-step entry. Correcting the port only after a network refresh was rejected because `loopbackUrl` does not change on disable, so the watcher never fires and the stale port remains.

## Consequences

The main-task branch of `POST /admin/tasks` now carries subtask creation intent; server tests pin successful mapping, owner validation, and the no-write boundary. Confirmation dismissal and share port restoration have component coverage. Supporting subtask updates or deletes at initial creation will require extending that intent while preserving the all-or-nothing semantics.
