# 06 · SQLite 存储设计

> 本文是 SQLite 单库的持久化契约。文件路径沿用 `06-database-design.md` 以稳定文档链接；产品的主要持久化已从分聚合 JSON + JSONL 迁移为 SQLite，原文件协议只作为旧数据导入和旧备份兼容的来源保留。

## 1. 存储原则

1. 单一权威数据库 `ztask.db`；当前状态与历史都在同一个库里，不再有“每实体一个 JSON 文件”。
2. 当前状态用关系表保存，受主键、外键和 CHECK 约束；历史 revision 保存不可变的完整 after-state 快照，读取时整条取出，保证任意时刻可还原。
3. 一次有效变更是一个 SQLite 事务：revision 行、当前状态行和 aggregate tip 在同一事务提交；崩溃由 WAL 回滚或恢复，不再有“先 append 再发布 current”的应用层窗口。
4. 单进程单写者；数据目录锁仍保留，SQLite 的锁是第二道防线，不是允许多实例共享同一数据目录的邀请。
5. 不使用 ORM；SQL、schema 和 migration 集中在存储层，业务层只依赖仓储接口。
6. 数据库文件不是运行时编辑接口；诊断用 `sqlite3` 或只读连接，写入只经服务。
7. 备份、恢复和迁移都以“一致性快照 + 校验 + 原子切换”为边界。

## 2. 数据目录

```text
~/.ztask/
  ztask.db
  ztask.db-wal
  ztask.db-shm
  locks/
  backups/
  tmp/
```

`ztask.db` 是唯一权威业务数据；`-wal`/`-shm` 是 SQLite 运行时文件，不属于备份内容，服务停止或检查点后自然消失。`locks/` 仍是数据目录单写者锁，`backups/` 保存备份目录，`tmp/` 保存导入、备份、恢复的临时文件；它们不是业务状态。数据目录 0700，`ztask.db` 与 sidecar 0600；Windows 上通过 ACL 或继承权限表达同等限制。

不再创建 `members/`、`folders/`、`tasks/`、`share-links/`、`auth-sessions/`；旧目录在迁移成功后整体移入 `backups/pre-sqlite-<时间戳>/`。

## 3. 版本、元数据与连接

### 3.1 schema 版本

`PRAGMA user_version` 是 schema 版本（首版 1）。`schema_migrations` 表记录每个已应用版本的版本号、时间和应用版本，作为审计与排障记录；启动以 `user_version` 做快速判断。`user_version` 高于应用支持版本时拒绝启动；低于时先备份再按顺序 migration。

`meta` 表保存应用级元数据：

| key | 含义 |
| --- | --- |
| `application_version` | 最近一次打开或迁移数据库的应用版本 |
| `created_at` | 数据库首次创建时间，UTC RFC 3339 |
| `time_zone` | 团队统一时区，创建后不由普通启动改写 |
| `legacy_imported_at` | 从旧文件格式导入完成的时间；新库为 NULL |
| `legacy_format_version` | 导入时旧 manifest 的 formatVersion；新库为 NULL |

### 3.2 连接参数

每个进程一个 `better-sqlite3` 连接（通过 Kysely `SqliteDialect`），打开后固定执行：

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA trusted_schema = OFF;
PRAGMA wal_autocheckpoint = 1000;
```

`WAL` 允许读不被写阻塞；`FULL` 保证每次提交落盘，与原来“revision fsync 后才是提交点”的耐久性目标一致。`foreign_keys=ON` 必须每个连接设置，业务约束不能只靠应用层。

同步 API 在单进程、小团队、数千任务规模下可接受；查询必须有索引和 LIMIT 或范围，不在请求路径扫描全表或全历史。

驱动选择 `better-sqlite3`：同步 API、Kysely 官方 `SqliteDialect`、被高 star Node/Electron 项目广泛使用，API 稳定；v13 自带 macOS/Linux/Windows 预编译二进制，安装不需要本地编译，Windows CI 也不需要 Visual Studio。`node:sqlite` 仍作为零原生依赖的备选，schema 与 SQL 不变，替换时只改连接和事务适配层。

### 3.3 启动校验

启动在持锁后、HTTP 开放前打开数据库并执行：

1. `PRAGMA quick_check` 必须返回 `ok`；
2. `PRAGMA foreign_key_check` 必须为空；
3. `user_version` 在支持范围内；
4. `meta` 必需键齐全，`time_zone` 能被 `Intl` 识别；
5. 每个 aggregate 的 `task_version`、tip 与最新 revision 一致（§7.4 的 SQL 断言）。

完整 `PRAGMA integrity_check` 不在每次启动做，留给备份、恢复、doctor 和显式诊断。

## 4. 表结构

### 4.1 一览

| 表 | 替代的旧文件 | 作用 |
| --- | --- | --- |
| `meta` | `manifest.json` | schema 之外的全局元数据、时区、导入标记 |
| `members` | `members/<id>.json` | 成员档案与归档 |
| `folders` | `folders/<id>.json` | 任务夹树 |
| `task_aggregates` | `tasks/<id>/current.json` 的版本与 tip 部分 | 主任务聚合版本与 revision tip |
| `tasks` | `current.json` 的 task/subtasks | 主任务与小任务的当前状态 |
| `assignments` | `current.json` 的 assignments | 主任务与小任务的负责人 |
| `task_revisions` | `tasks/<id>/revisions.jsonl` | 不可变完整快照历史 |
| `share_links` | `share-links/<memberId>.json` | 每成员最多一条当前链接 |
| `auth_sessions` | `auth-sessions/<sessionId>.json` | 成员登录会话 |
| `network_config` | `network.json` | 期望恢复的 LAN 配置 |

### 4.2 DDL

```sql
CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  archived_at TEXT
) STRICT;

CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  parent_id  TEXT REFERENCES folders(id),
  name       TEXT NOT NULL,
  position   INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
) STRICT;

CREATE TABLE task_aggregates (
  task_id          TEXT PRIMARY KEY,
  format_version   INTEGER NOT NULL DEFAULT 1,
  task_version     INTEGER NOT NULL CHECK (task_version >= 1),
  updated_at       TEXT NOT NULL,
  tip_revision_id  TEXT NOT NULL UNIQUE,
  tip_task_version INTEGER NOT NULL,
  tip_recorded_at  TEXT NOT NULL,
  tip_change_kind  TEXT NOT NULL CHECK (tip_change_kind IN ('create','update','progress','detail','subtask','delete')),
  tip_checksum     TEXT NOT NULL,
  CHECK (tip_task_version = task_version)
) STRICT;

CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL REFERENCES task_aggregates(task_id),
  parent_id    TEXT REFERENCES tasks(id),
  folder_id    TEXT NOT NULL REFERENCES folders(id),
  description  TEXT NOT NULL,
  progress     INTEGER NOT NULL CHECK (progress BETWEEN 0 AND 100),
  detail_text  TEXT,
  importance   TEXT NOT NULL CHECK (importance IN ('high','mid','low')),
  due_date     TEXT,
  created_at   TEXT NOT NULL,
  deleted_at   TEXT,
  CHECK (parent_id IS NULL OR parent_id = aggregate_id),
  CHECK (parent_id IS NOT NULL OR id = aggregate_id),
  CHECK (parent_id IS NOT NULL OR detail_text IS NOT NULL),
  CHECK (parent_id IS NULL OR detail_text IS NULL),
  CHECK (due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
) STRICT;

CREATE TABLE assignments (
  task_id      TEXT NOT NULL REFERENCES tasks(id),
  aggregate_id TEXT NOT NULL REFERENCES task_aggregates(task_id),
  member_id    TEXT NOT NULL REFERENCES members(id),
  kind         TEXT NOT NULL CHECK (kind IN ('owner','collaborator')),
  PRIMARY KEY (task_id, member_id)
) STRICT;

CREATE TABLE task_revisions (
  revision_id     TEXT PRIMARY KEY,
  aggregate_id    TEXT NOT NULL REFERENCES task_aggregates(task_id),
  format_version  INTEGER NOT NULL DEFAULT 1,
  task_version    INTEGER NOT NULL CHECK (task_version >= 1),
  recorded_at     TEXT NOT NULL,
  change_kind     TEXT NOT NULL CHECK (change_kind IN ('create','update','progress','detail','subtask','delete')),
  actor_kind      TEXT NOT NULL CHECK (actor_kind IN ('admin','member')),
  actor_member_id TEXT,
  actor_name      TEXT NOT NULL,
  checksum        TEXT NOT NULL,
  snapshot_json   TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  UNIQUE (aggregate_id, task_version)
) STRICT;

CREATE TABLE share_links (
  id           TEXT PRIMARY KEY,
  member_id    TEXT NOT NULL UNIQUE REFERENCES members(id),
  token_hash   TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL CHECK (status IN ('active','revoked')),
  created_at   TEXT NOT NULL,
  revoked_at   TEXT,
  last_used_at TEXT
) STRICT;

CREATE TABLE auth_sessions (
  session_id    TEXT PRIMARY KEY,
  member_id     TEXT NOT NULL REFERENCES members(id),
  share_link_id TEXT NOT NULL REFERENCES share_links(id),
  verifier_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
) STRICT;

CREATE TABLE network_config (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  format_version INTEGER NOT NULL,
  enabled        INTEGER NOT NULL CHECK (enabled IN (0,1)),
  host           TEXT,
  port           INTEGER CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
  share_base_url TEXT
) STRICT;

CREATE TABLE schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL,
  app_version TEXT NOT NULL
) STRICT;
```

### 4.3 约束说明

- 主任务 `parent_id IS NULL` 且 `id = aggregate_id`；小任务 `parent_id = aggregate_id`，因此层级最多两层，且小任务必须与主任务同聚合。`tasks.aggregate_id` 外键保证聚合存在；“聚合必须有主任务”由启动和 doctor 的引用校验兜底，SQLite 无法用简单外键表达这种循环。
- 小任务不保存 `detail_text`（NULL）；主任务必须非 NULL。`due_date` 允许 NULL（未设置，现有 DTO 与服务已接受），非 NULL 时必须是合法的 `YYYY-MM-DD`；导入按现状保留 NULL，不伪造日期，null 不进入预计完成分布。
- `assignments` 的主键 `(task_id, member_id)` 复刻现有唯一性；`task_id` 必须属于 `aggregate_id`，由写入路径校验，doctor 复核。
- `share_links.member_id UNIQUE` 保证每成员最多一条当前链接；rotate 在同一事务内先删关联 session、再替换链接行，避免外键悬挂。
- `auth_sessions` 只保存认证状态；过期清理是 `DELETE`，不属于历史。
- 所有时刻是 UTC RFC 3339 文本；`due_date` 是 `YYYY-MM-DD` 或 NULL，不做 UTC 转换。
- 事务、外键、CHECK、`json_valid` 是数据库层约束；服务层仍做业务校验和友好错误，不把 SQLite 错误直接暴露给客户端。

## 5. 当前状态、历史与索引

### 5.1 当前状态

`tasks` 是主任务与小任务当前状态的唯一来源；`task_aggregates` 保存共享的 `taskVersion` 和 revision tip。读取一个聚合时取主任务行、该 `aggregate_id` 下的全部小任务行和该聚合的 assignments，按 `created_at, id` 稳定排序。列表查询用 JOIN 一次取多条，不做 N+1。

### 5.2 历史快照

`task_revisions.snapshot_json` 保存与旧 `revisions.jsonl` 完全相同的 `{task, subtasks, assignments}` after-state；`checksum` 是对不含 checksum 字段的规范化 JSON 计算的 SHA-256。历史保持“每次有效变更一条完整快照”，不做 delta，不存 diff。

选择 JSON 快照而不是把历史完全拆成关系表，原因：

- 历史是不可变事实，读取方式是整条快照比较，不是按字段查询；
- 未来任务字段演进时，旧快照仍能原样还原，不会因新列或新约束被重写；
- 当前状态已经规范化，查询与约束能力不受影响。

`UNIQUE(aggregate_id, task_version)` 保证同一聚合版本只有一条；`task_aggregates.tip_revision_id` 指向最新一条，`tip_checksum` 与它一致。tip 字段是读快路径，权威仍是 `task_revisions` 中版本最大的行。

checksum 的输入保持旧 `RevisionLine` 的逻辑形状（`formatVersion`、`revisionId`、`taskId`、`taskVersion`、`recordedAt`、`changeKind`、`actor`、`snapshot`），不是表列直接拼接；导入时按同一形状重算并与旧行 checksum 比对，保证历史完整性校验口径不变。

### 5.3 索引

```sql
CREATE INDEX tasks_folder_idx ON tasks(folder_id, deleted_at);
CREATE INDEX tasks_aggregate_idx ON tasks(aggregate_id);
CREATE INDEX tasks_parent_idx ON tasks(parent_id);
CREATE INDEX assignments_member_idx ON assignments(member_id);
CREATE INDEX assignments_aggregate_idx ON assignments(aggregate_id);
CREATE INDEX task_revisions_range_idx ON task_revisions(aggregate_id, recorded_at DESC, task_version DESC);
CREATE INDEX task_revisions_recorded_idx ON task_revisions(recorded_at);
CREATE INDEX auth_sessions_member_idx ON auth_sessions(member_id);
CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at);
CREATE INDEX share_links_status_idx ON share_links(status);
```

查询口径：

- 任务夹后代用递归 CTE（`WITH RECURSIVE`）或服务层一次加载的小树；任务列表按 `folder_id IN (...)`、`deleted_at`、`importance`、`ownerIds` 组合过滤，排序 `created_at ASC, id ASC`，cursor 仍由 createdAt/id 生成。
- `ownerIds` 先在 `assignments` 上求主任务或小任务命中，再决定整条返回或裁剪小任务，口径与旧 `activeOwnersByTask` / `activeSubtaskOwnersByTask` 一致；归档成员用 `members.archived_at` 排除。
- 看板 summary 用 `tasks` 和 `assignments` 的 `GROUP BY` / `CASE` 聚合；历史候选包含 `deleted_at` 非空的任务，按 `task_revisions.recorded_at` 范围查询。
- 历史 as-of 单任务查询为 `WHERE aggregate_id=? AND (recorded_at < :at OR (recorded_at = :at AND task_version <= :version)) ORDER BY recorded_at DESC, task_version DESC LIMIT 1`；多任务用窗口函数或按候选逐条查询，走 `task_revisions_range_idx`。
- 不再有启动时从文件重建的 `byId`、`folderChildren`、`assignmentsByMember` 内存索引；SQL 索引就是查询索引，任何缓存只能是从库重建的加速层。

## 6. 事务写协议

### 6.1 任务聚合提交

所有任务写走同一个 `commit`：

```text
队列内（按 taskId 串行）
  → BEGIN IMMEDIATE
  → 读 aggregate（tasks + assignments + task_aggregates）
  → 比较 expectedVersion；不一致回滚并抛 version conflict
  → 在内存中 mutate，生成完整 after-state
  → 与当前快照比较；无实际变化回滚，不写 revision
  → 生成 revisionId / recordedAt / checksum
  → INSERT task_revisions（完整快照）
  → 更新 tasks / assignments 当前状态
  → UPDATE task_aggregates 的 task_version / tip / updated_at
  → COMMIT
```

revision 行、当前状态和 tip 在同一事务提交；不存在“revision 已写、current 未写”或相反的窗口。`BEGIN IMMEDIATE` 在事务开始就取得写锁，避免读后升级写锁的竞争；单进程下它主要防外部连接。版本冲突以 `task_version` 为准；`UPDATE ... WHERE task_id=? AND task_version=?` 的 `changes()=0` 也可作为第二道检查。任一 SQL 或校验失败都回滚，不留下半状态；SQLite 错误在存储层映射为现有 `StorageError` / `VersionConflictError`，不把 SQL 文本暴露给 API。`expectedVersion` 的预检仍在路由入口做，但最终检查必须在事务内。

### 6.2 非任务写

- folder、member、share-link、network 的创建、改名、归档、rotate、revoke 各自一个短事务；没有跨聚合级联。
- 成员归档可以在一个事务里完成：吊销或清理链接、删除该成员 session、写 `archived_at`。旧文件方案的“先吊销再归档”中间态在 SQLite 下不再必要；业务错误仍按现有映射返回。
- rotate 在一个事务里删除旧 session、替换链接行；revoke 在一个事务里改 `status/revoked_at` 并删除 session。残留 session 的 `shareLinkId` 和状态校验仍是最终授权兜底。
- `lastSeenAt` 按分钟级节流 `UPDATE`，避免每次请求写库；过期 session 用 `DELETE` 清理，可在启动时批量执行。

### 6.3 队列与关闭

保留进程内 `WriteQueue`：它提供按 taskId/memberId 的提交顺序和 `pauseWrites()` 一致性边界，不承担文件 IO。SQLite 事务是最终的并发边界。关闭顺序为停止监听 → 排空写队列 → `PRAGMA wal_checkpoint(TRUNCATE)` → 关闭数据库连接 → 释放数据目录锁。checkpoint 让下次启动更快，也避免把大 WAL 留给备份或恢复。

## 7. 启动、迁移与旧数据导入

### 7.1 启动顺序

```text
配置校验 → 数据目录 0700 → 获取单写者锁 → 打开 ztask.db（不存在则创建或导入）
  → PRAGMA 设置 → schema 版本检查或迁移 → quick_check + foreign_key_check
  → meta / aggregate 一致性校验 → 装配 Service → loopback 监听 → LAN 恢复
```

数据库不可用（损坏、版本过高、迁移失败、引用不一致）时拒绝启动并释放锁，不以空库或半迁移状态开放 HTTP。

### 7.2 旧文件导入（一次性）

当 `ztask.db` 不存在且存在旧 `manifest.json` 时：

1. 在 `tmp/` 创建临时数据库，建 schema。
2. 读旧 manifest、network.json、members、folders、tasks/current.json 与 revisions.jsonl、share-links、auth-sessions。
3. 在一个事务内导入 meta、成员、任务夹、聚合、主任务与小任务、分配、全部 revision、链接、会话和网络配置。
4. 逐项校验：revision checksum 重算并与旧行一致；taskVersion 从 1 连续；tip 与最新 revision 一致；folder、member、aggregate、task 引用闭合；计数与旧文件数一致。
5. `PRAGMA integrity_check` 和 `foreign_key_check` 通过后，`wal_checkpoint(TRUNCATE)`、关闭连接，把临时库原子 rename 为 `ztask.db`。
6. 把旧 `manifest.json`、`network.json`、`members/`、`folders/`、`tasks/`、`share-links/`、`auth-sessions/` 整体移入 `backups/pre-sqlite-<UTC 时间戳>/`；保留 `locks/`、`tmp/`、`backups/`。
7. 任一步失败：删除临时库，旧文件保持原样，启动失败并提示修复或从备份恢复。不允许“导入失败但用空库启动”。

若 `ztask.db` 与旧 `manifest.json` 同时存在，启动拒绝并提示二选一（通常是手工复制残留）；不静默忽略任一来源。迁移成功后旧文件已移走，正常不会出现。

旧备份兼容：`restore` 遇到只有 `manifest.json` 和 JSONL、没有 `ztask.db` 的备份目录时，按同一导入器在 staging 目录生成新库，再切换；新备份一律是 SQLite 快照。

### 7.3 schema migration

- `user_version < SCHEMA_VERSION`：先暂停写入，用 `VACUUM INTO` 生成 `backups/pre-migrate-<时间戳>/ztask.db`，再在单个事务内按版本顺序执行 migration SQL，更新 `schema_migrations` 与 `user_version`。失败则回滚并拒绝启动，保留迁移前备份。
- `user_version > SCHEMA_VERSION`：应用太旧，拒绝启动并提示升级。
- 迁移脚本只做 schema 和数据变换，不依赖网络或外部文件；每一步可重入或在失败时整体回滚。
- 首版没有历史 migration；旧文件导入是独立的一次性路径，不占用 `user_version` 的 schema 迁移序列。

### 7.3.1 迁移框架选型

SQLite 的 `ALTER TABLE` 能力有限：改列类型、约束、主键或 `STRICT` 声明通常要按官方“12 步”重建表；迁移必须在失败时整体回滚，且要能在 CI 里用旧版本数据验证。业界成熟的版本化迁移骨架是 `schema_migrations(version, name, checksum, applied_at, app_version)` 加 `PRAGMA user_version`：启动时按版本顺序执行未应用项，每个迁移一个事务，迁移前备份，失败拒绝启动。dbmate、goose、Kysely Migrator、Umzug、Flyway 和 Liquibase 都是这个骨架的不同实现。

| 方案 | 代表 | 优点 | 代价 |
| --- | --- | --- | --- |
| A. 自研轻量 runner | 本仓库 | 无新运行时依赖，直接配合 `better-sqlite3`、数据目录锁和 `VACUUM INTO` 备份；DDL 与数据迁移都可控 | runner、checksum 和测试要自己写；没有现成的 down/rollback |
| B. 轻量框架 | Kysely Migrator + `better-sqlite3`；Umzug | 迁移表、顺序、锁、up/down 现成；Kysely 还提供查询构建器 | 多一个或两个依赖；Umzug 需自定义 storage；仍要自己接备份和校验 |
| C. ORM 迁移 | Drizzle ORM + drizzle-kit；Prisma | schema 即代码，自动生成 SQL，类型安全，带漂移检查 | 与 ORM 绑定；driver 支持以 better-sqlite3/libsql 为主，工具链更重 |
| D. 外部 CLI | dbmate、goose、Atlas、Sqitch、Flyway | 成熟、语言无关、适合 CI 和运维 | 不是 `ztask serve` 内嵌路径；本地单命令启动还要额外安装或调用二进制 |

已确认采用 B 的 Kysely Migrator：它成熟、TypeScript 原生、可内嵌运行，迁移表、迁移锁、up/down 和 `migrateToLatest` 都是现成的，不强制采用 ORM，迁移文件仍写原生 SQL；驱动配 `better-sqlite3` 的 Kysely 官方 SQLite dialect。应用层仍补 `VACUUM INTO` 备份、`schema_migrations` checksum 审计和完整性校验。

若不考虑自研，推荐 B 中的 Kysely Migrator：它成熟、TypeScript 原生、可内嵌运行，迁移表、迁移锁、up/down 和 `migrateToLatest` 都是现成的，不强制采用 ORM，迁移文件仍可写原生 SQL；配 `better-sqlite3` 使用 Kysely 官方 SQLite dialect。若接受 ORM 并希望 schema 即代码、自动生成 SQL 和漂移检查，选 C 的 Drizzle + drizzle-kit（配 better-sqlite3/libsql）。Umzug 更轻但要自定义 storage；D 只用于 CI 的 schema lint 或漂移检查，不作为运行时入口。

### 7.3.2 推荐执行流程

1. 启动持锁后读取 `PRAGMA user_version`；高于 `SCHEMA_VERSION` 拒绝启动，等于则继续。
2. 低于时先 `VACUUM INTO` 到 `backups/pre-migrate-<时间戳>/`，并校验副本。
3. Kysely Migrator 按 `kysely_migration` 执行未应用迁移（每个 migration 一个事务）；执行后写 `schema_migrations` 的版本/checksum 审计并更新 `user_version`；失败回滚并保留备份。
4. 全部成功后跑 `foreign_key_check`、`integrity_check` 和 §7.4 的业务断言；失败拒绝启动。
5. 已应用迁移的 `checksum` 与文件不一致时拒绝启动（防止发布后改历史迁移）；只允许追加新迁移。
6. 迁移是单向的：不自动 down；回滚用 `pre-migrate` 备份或旧版本应用加旧备份。复杂表变更按 SQLite 官方 12 步重建：事务外 `PRAGMA foreign_keys=OFF`，建新表，复制，删旧表，改名，重建索引和触发器，`foreign_key_check`，再 `COMMIT`。

### 7.3.3 测试与发布纪律

- 每个已发布 schema 版本保留一个 fixture；测试从版本 N 的库跑到最新，断言数据、外键、revision checksum 和 `user_version`。
- 同一 PR 新增迁移和 fixture；不允许改已发布迁移（checksum 会拒绝）。
- CI 对最新库做 schema 快照或漂移检查（`sqlite3 .schema` 或迁移后 schema dump），并跑 `integrity_check`。
- 迁移脚本里不做网络、文件系统或耗时操作；数据迁移用 TS 函数时也要保持确定性、可重入。
- 备份和恢复测试覆盖“迁移前备份可恢复”和“迁移失败不改变原库”。

**调研依据**：[SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)、[PRAGMA user_version](https://www.sqlite.org/pragma.html#pragma_user_version)、[Kysely Migrator](https://kysely.dev/docs/migrations)、[Umzug](https://github.com/sequelize/umzug)、[Drizzle Kit migrations](https://orm.drizzle.team/docs/migrations)、[dbmate](https://github.com/amacneil/dbmate)、[goose](https://github.com/pressly/goose)、[Atlas 版本化迁移](https://atlasgo.io/concepts/declarative-vs-versioned)、[Sqitch SQLite](https://sqitch.org/docs/manual/sqitchtutorial-sqlite/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)、[Kysely SQLite dialect](https://kysely.dev/docs/dialects)。

### 7.4 一致性校验

启动与 doctor 共用一组 SQL 断言：

```sql
-- 每个聚合的版本号必须从 1 连续，且数量与最大版本一致
SELECT aggregate_id FROM task_revisions
GROUP BY aggregate_id
HAVING MIN(task_version) <> 1 OR MAX(task_version) <> COUNT(*);

-- tip 必须指向最新 revision
SELECT a.task_id FROM task_aggregates a
LEFT JOIN task_revisions r ON r.revision_id = a.tip_revision_id
WHERE r.revision_id IS NULL
   OR r.task_version <> a.task_version
   OR r.checksum <> a.tip_checksum
   OR r.aggregate_id <> a.task_id;

-- 聚合必须有主任务行
SELECT a.task_id FROM task_aggregates a
LEFT JOIN tasks t ON t.id = a.task_id AND t.parent_id IS NULL
WHERE t.id IS NULL;

-- 分配的任务必须属于该聚合
SELECT x.task_id FROM assignments x
LEFT JOIN tasks t ON t.id = x.task_id
WHERE t.id IS NULL OR t.aggregate_id <> x.aggregate_id;
```

`quick_check` 只查页结构；以上业务断言在启动时执行，失败即拒绝启动。doctor 额外做 `integrity_check`、`foreign_key_check` 和当前状态与最新快照的深比较。

## 8. 备份、恢复与 doctor

### 8.1 在线备份

```text
pauseWrites()（停新写入并等待在途事务）
  → 在 <dataDir>/tmp/backup-<uuid>/ 下 VACUUM INTO 'ztask.db'
  → 对副本执行 integrity_check、foreign_key_check、schema / 引用 / 版本校验
  → 写 backup.json 报告
  → rename 临时目录到 backups/<UTC 时间戳>-<uuid>/
  → resume()
```

`VACUUM INTO` 产出的是单文件、无 WAL、已压实的完整快照；不会复制 `-wal`/`-shm`，也不受复制过程中页变化影响。备份目录结构为 `ztask.db` 加 `backup.json`；报告保留现有字段（`formatVersion/appVersion/createdAt/timeZone/dataDir/files/bytes/excluded/validation`），`files=1`、`bytes=数据库文件字节数`，并新增 `schemaVersion` 与各表行数摘要，API 和 CLI 的既有字段不破坏。

备份期间暂停写队列，保证报告中的时间、计数和快照对应同一时刻；`VACUUM INTO` 本身也能给出读一致性快照，但暂停让边界更简单。备份是完整快照，不压缩、不自动清理旧备份；排除 `locks/`、`tmp/`、`backups/`、`.ztask-lock` 与 SQLite sidecar。

### 8.2 恢复

1. 只读校验备份：`ztask.db` 存在，`PRAGMA integrity_check` 和 `foreign_key_check` 通过，`user_version` 可处理，`backup.json` 与库摘要一致；旧格式备份走 §7.2 导入器。
2. 目标目录必须不存在或为空；在目标同级创建 `.ztask-restore-<uuid>/` 暂存目录。
3. 复制或导入到暂存目录，用 `initStore` 真实打开、必要时 migration、跑一致性校验，再关闭并 `wal_checkpoint(TRUNCATE)`。
4. `rename` 暂存目录到目标目录；失败删除暂存，不留下半恢复目录。

恢复不直接覆盖运行中的库；切换前停止服务，切换后重新执行启动校验。旧版本应用无法读取新库，回滚需要 `backups/pre-sqlite-*` 中的旧文件。

### 8.3 doctor

`ztask doctor` 对数据目录做只读体检：

- 打开数据库只读，或对只读副本执行 `VACUUM INTO` 后检查，不执行应用写路径；SQLite 可能创建或删除临时 `-shm`，但数据库内容不被修改。
- 检查 `integrity_check`、`foreign_key_check`、`user_version` 与 `meta`、revision 序列、tip、聚合主任务、分配引用、folder 父链、share-link 与 session 引用；可选深比较当前状态与最新快照。
- 报告保留现有 `ok/fileCount/byteCount/manifest/issues/autoFixable/needsBackup/suggestions` 形状；`manifest` 映射为 meta 摘要，`formatVersion` 显示 schema 版本。SQLite 事务消除了 JSONL 尾部与 current 落后类自愈问题，`autoFixable` 正常为空；结构性问题一律归 `needsBackup`，建议从最近备份恢复或人工取证。
- doctor 不自动修复；修复入口是恢复。需要导出诊断时只输出表计数和校验摘要，不输出任务正文、token 或会话哈希。

## 9. 时间、容量与兼容边界

- 所有时刻是 UTC RFC 3339 文本，按字符串比较即可；同刻用 `task_version` 决胜。团队时区只用于看板“今天”和日期边界，不改变存储值。
- 首版目标为单实例、几十名成员、数千主任务、单任务数千条 revision。SQLite 页缓存与索引足够；历史查询必须限定聚合或时间范围，不做全库全历史扫描。
- 历史只追加，不自动压缩或删除；需要缩小库时用 `VACUUM` 或离线归档，且必须保留任意时间范围 as-of 查询能力。
- 不加密静态数据：数据库文件权限与数据目录权限是唯一边界；`sqlite3` 可读意味着本机同用户可读，与原“JSON 可读”的威胁模型一致。
- 不支持多进程或网络共享目录共同写入；数据目录锁和 SQLite 锁只保护单机单实例。
- 不再支持直接编辑业务 JSON；需要人工修复时用 `sqlite3` 只读检查，写操作必须经服务或显式恢复。
- 迁移是单向的：升级后旧应用无法读取 `ztask.db`；回滚依赖 `pre-sqlite` 备份。新应用可导入旧备份或旧目录。

## 10. 受影响模块

- `apps/server/src/storage/`：新增 `db.ts`（连接、pragma、事务）、`schema.ts`（DDL）、`migrations/`、`meta-store.ts`、`task-store.ts`（SQL 仓储）、`folder-store.ts`、`member-store.ts`、`share-store.ts`、`network-store.ts`；删除 `atomic-json.ts`、`jsonl.ts`、`manifest-store.ts`、`entity-store.ts`，并用 SQL 查询取代 `indexes.ts` 的派生索引；`checksum.ts` 保留。
- `apps/server/src/storage/store.ts`：`initStore` 改为打开、迁移、校验和装配；不再重建 current 与内存派生索引。
- `apps/server/src/modules/maintenance/`：`backup-service` 用 `VACUUM INTO`，`restore-service` 支持新旧备份，`validate-service` 与 `doctor-service` 改为 SQL 校验。
- `apps/server/src/modules/network/network-service.ts`、`modules/share/share-auth.ts`、`modules/share/share-links.ts`、`modules/folders/folder-service.ts`、`modules/members/member-service.ts`、`modules/tasks/*`、`modules/dashboard/*`：从文件或实体存储切到仓储，接口与 DTO 不变。
- `apps/server/src/bootstrap.ts` 与 `apps/server/src/lock.ts`：启动顺序不变，锁保留；close 增加 checkpoint 和数据库关闭。
- `packages/shared/`：API DTO 不变；如备份或 doctor 报告新增字段，按可选字段扩展，避免破坏现有客户端。
- `tests/`：替换原子写、JSONL 和尾恢复测试为 schema、事务回滚、版本冲突、WAL 恢复、旧数据导入、备份恢复、doctor 和 SQL 查询口径测试；故障注入改为事务前后与进程中止。
- `package.json`：`engines.node` 为 `>=22`（better-sqlite3 要求 Node >=22；v13 prebuilds 覆盖 CI 平台），并在 README 和开发文档说明。
- 迁移门禁：新增 migration 必须同步更新 `tests/fixtures/migrations/checksums.json`，并保留 `tests/fixtures/schema/v1/ztask.db` 供升级 fixture 测试；`pnpm test` 会校验已发布 checksum、v1 升级、备份恢复与降级拒绝。

## 11. 待确认

1. 驱动：已确认 `better-sqlite3` + Kysely `SqliteDialect`；`node:sqlite` 作为零原生依赖的备选。
2. 历史保留：revision 仍保存完整 JSON 快照；确认接受“当前状态关系化、历史快照 JSON”的混合形态，而不是把历史也完全拆表。
3. 旧文件处理：迁移成功后把旧文件移入 `backups/pre-sqlite-*` 保留回滚，而不是删除。
4. 网络配置：`network.json` 也并入数据库；`locks/`、`backups/`、`tmp/` 仍是文件系统。若希望保留 `network.json` 便于手工查看，可在实施前调整。
5. 迁移框架：已确认 B 的 Kysely Migrator（配 `better-sqlite3` 官方 SQLite dialect）；A/C/D 仅作为后续替换备选，对比见 §7.3.1。
