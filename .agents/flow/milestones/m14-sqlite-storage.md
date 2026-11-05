# 阶段 14：SQLite 存储迁移

[English](m14-sqlite-storage.en.md) | 中文

```yaml flow
kind: milestone
id: m14
title: 阶段 14：SQLite 存储迁移
status: active
github:
  number: 14
  url: https://github.com/Shadow-Azure/ZTask/milestone/14
```

本阶段把 ZTask 的主要持久化从分聚合 JSON + JSONL 迁移到 SQLite 单库。先交付设计文档评审，确认后实施、验证并完成旧数据导入与备份恢复兼容。

## 交付边界

- 设计文档、proposed Agent Note 与评审结论。
- 实施阶段完成 schema、事务写协议、旧文件导入、备份恢复、doctor 和测试替换。
- 不改变既有 API DTO、权限语义和 UI 行为；不改动多进程或跨机同步。

## 阶段验收

- 设计评审通过，06/04/01/07/09 与 README 对 SQLite 的口径一致。
- 实施后旧数据可完整导入，事务提交/回滚、备份恢复和完整性校验通过。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow` 全绿。
