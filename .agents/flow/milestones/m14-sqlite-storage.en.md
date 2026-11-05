# Stage 14: SQLite storage migration

English | [中文](m14-sqlite-storage.md)

```yaml flow
kind: milestone
id: m14
title: 阶段 14：SQLite 存储迁移
status: active
github:
  number: 14
  url: https://github.com/Shadow-Azure/ZTask/milestone/14
```

This stage moves ZTask's primary persistence from per-aggregate JSON + JSONL to a single SQLite database. It first delivers the design documents for review; after confirmation, it implements, verifies, and completes legacy-data import and backup/restore compatibility.

## Delivery boundary

- Design documents, the proposed Agent Note, and the review decision.
- The implementation stage covers schema, transactional writes, legacy import, backup/restore, doctor, and test replacement.
- Existing API DTOs, permission semantics, and UI behavior do not change; multi-process or cross-machine sync remains out of scope.

## Stage acceptance

- The design review passes, and 06/04/01/07/09 plus the README agree on the SQLite contract.
- After implementation, legacy data imports completely, and transaction commit/rollback, backup/restore, and integrity checks pass.
- `pnpm test`, `pnpm lint:docs`, `pnpm verify:docs`, and `pnpm verify:flow` are all green.
