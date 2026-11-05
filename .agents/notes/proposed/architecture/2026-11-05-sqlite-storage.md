# Agent Note: 用 SQLite 单库取代分聚合文件存储

Status: proposed

[English](2026-11-05-sqlite-storage.en.md) | 中文

## Problem

当前存储把成员、任务夹、任务聚合、历史、分享链接、会话和网络配置拆成 JSON/JSONL 文件。为了在崩溃后保持一致，应用层必须自己实现临时文件 + fsync + rename、JSONL checksum 与尾行恢复、current 与 revision tip 对账、启动重建索引，并靠约定维持跨实体引用。逻辑正确性分散在原子写、恢复、索引和各个 service 中，新增查询或实体时容易漏掉一条恢复路径。用户明确要求把当前文件结构改为 SQLite。

## Decision

- 使用单个 `ztask.db` 作为唯一权威业务库，`node:sqlite` 的 `DatabaseSync` 连接，WAL、`synchronous=FULL`、外键开启；数据目录锁和单进程写队列保留。
- 当前状态关系化到 `members`、`folders`、`tasks`、`assignments`、`share_links`、`auth_sessions`、`network_config`、`meta`；主任务与小任务共享 `task_aggregates` 的版本。
- 历史保留为 `task_revisions` 的不可变完整 JSON 快照，checksum 继续用规范化 JSON 的 SHA-256；当前状态与历史不做双向同步。
- 一次有效变更是一个 `BEGIN IMMEDIATE` 事务：revision、当前状态、aggregate tip 同事务提交；版本冲突在事务内复查；no-op 不写 revision。
- 旧文件通过一次性导入器进入临时库，校验后原子 rename，再把旧目录移入 `backups/pre-sqlite-*`；旧备份可由同一导入器恢复。
- schema 版本用 `PRAGMA user_version`，迁移前 `VACUUM INTO` 备份，迁移在事务内执行；`integrity_check`、`foreign_key_check` 和 revision 序列与 tip 断言用于启动、备份、恢复和 doctor。
- 在线备份用 `VACUUM INTO` 生成单文件一致性快照；备份目录为 `ztask.db` 加 `backup.json`。
- schema migration 默认用自研轻量 runner：`schema_migrations` 记录版本与 checksum，启动时事务化执行，迁移前 `VACUUM INTO` 备份；Kysely/Umzug、Drizzle/Prisma 和外部 CLI 作为备选，对比见 06 §7.3.1。

详细契约见[全栈设计 06](../../../../plan/fullstack-design/06-database-design.md)。

## Alternatives considered

- 继续使用分聚合 JSON + JSONL 并加固恢复：保留纯文本可读和无原生依赖，但原子写、尾行恢复、current 对账和派生索引仍由应用维护，跨实体一致性仍靠约定；否决。
- 使用 `better-sqlite3`：API 更稳定，但有原生依赖和安装、CI 成本；`node:sqlite` 已满足单进程同步访问，先选内置驱动；若 Node 版本下限不可接受再切换。
- 引入 ORM：当前查询面小且需要精确控制事务与 SQL 计划，手写 SQL 加仓储更透明；否决。
- 每聚合一个数据库：事务边界更小，但备份、迁移、跨实体查询和引用校验更复杂；单库更符合当前规模；否决。
- 历史也完全拆成关系表：历史是整条不可变快照，字段演进时旧快照会被新约束影响；保留 JSON 快照；否决。

## Consequences

- 失去“每个实体一个可读 JSON 文件”的透明度；诊断改用 `sqlite3` 或只读连接，人工编辑不再受支持。
- 迁移单向：升级后旧应用无法读取 `ztask.db`，回滚依赖 `backups/pre-sqlite-*`。
- `node:sqlite` 要求 Node >= 22.13，且仍是 experimental；`engines.node` 需要提升，驱动替换点集中在连接适配层。
- SQLite 不加密静态数据；数据库文件权限成为唯一保护，和原 JSON 文件的威胁模型一致。
- 需要建立 schema migration、备份恢复和 revision checksum 的测试矩阵；原原子写、JSONL 和尾恢复测试将被替换。
- 这是架构级变更：`docs/architecture.md` 在实施 PR 中更新，开发流程 issue 和 milestone 在确认后创建；本轮只交付设计评审。
