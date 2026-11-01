# Roadmap

English | [中文](roadmap.md)

```yaml flow
kind: roadmap
milestones:
  - m1
  - m2
  - m3
  - m4
  - m5
```

ZTask provides task collaboration through a local CLI, web service, and file storage. See [README](README.en.md) for rules; `plan/fullstack-design/` and the approved prototype are the baseline.

## Delivery sequence

- m1: Prototype, full-stack design, and engineering flow tree.
- m2: Same-origin CLI service, reliable file writes, and shared Vue shells.
- m3: Folder, member, and task management with a real tracker.
- m4: LAN sharing, secure sessions, and minimal owner writes.
- m5: Dashboard, two-column diffs, backup recovery, and end-to-end acceptance.

## Progression principles

- Advance milestones in order and serialize equal-priority work across them; deliver permissions, recovery, and version conflicts with their owning capabilities.
- Issues start in backlog and move after `pnpm flow:sync` backfills their numbers; M1 retains its actual state.
