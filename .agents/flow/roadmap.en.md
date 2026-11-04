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
  - m6
  - m7
  - m8
  - m9
  - m10
  - m11
  - m12
```

ZTask provides task collaboration through a local CLI, web service, and file storage. See [README](README.en.md) for rules; the baseline is `plan/fullstack-design/`.

## Delivery sequence

- m1: Prototype, full-stack design, and flow tree.
- m2: Same-origin CLI, reliable file writes, and shared Vue shells.
- m3: Folder, member, and task management with a tracker.
- m4: LAN sharing, secure sessions, and minimal owner writes.
- m5: Dashboard, two-column diffs, backup recovery, and end-to-end acceptance.
- m6: Screen-by-screen parity with the prototype and a clean difference ledger.
- m7: Project showcase image and repository front page.
- m8: Assignee filter refinement for the task management prototype.
- m9: Subtask save errors and diagnosability.
- m10: Dashboard filter fix.
- m11: Task card modal.
- m12: Diagnosable startup-occupancy errors.

## Progression principles

- Advance milestones in order and serialize equal-priority work across them; deliver permissions, recovery, and version conflicts with their owning capabilities.
- Issues start in backlog and move after `pnpm flow:sync` backfills their numbers; M1 retains its actual state.
