/**
 * SQLite schema（06 §4）：当前状态关系化，历史保存完整快照。
 *
 * DDL 拆成单条语句，便于用 Kysely 的 `sql.raw` 逐条执行；所有语句同时被
 * 初始 migration 和测试的“空库建表”路径复用。STRICT 表要求 SQLite >= 3.37，
 * `better-sqlite3` 内置的 SQLite 已满足。
 */
export const DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE members (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL,
    color       TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    archived_at TEXT
  ) STRICT`,
  `CREATE TABLE folders (
    id         TEXT PRIMARY KEY,
    parent_id  TEXT REFERENCES folders(id),
    name       TEXT NOT NULL,
    position   INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  ) STRICT`,
  `CREATE TABLE task_aggregates (
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
  ) STRICT`,
  `CREATE TABLE tasks (
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
  ) STRICT`,
  `CREATE TABLE assignments (
    task_id      TEXT NOT NULL REFERENCES tasks(id),
    aggregate_id TEXT NOT NULL REFERENCES task_aggregates(task_id),
    member_id    TEXT NOT NULL REFERENCES members(id),
    kind         TEXT NOT NULL CHECK (kind IN ('owner','collaborator')),
    PRIMARY KEY (task_id, member_id)
  ) STRICT`,
  `CREATE TABLE task_revisions (
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
  ) STRICT`,
  `CREATE TABLE share_links (
    id           TEXT PRIMARY KEY,
    member_id    TEXT NOT NULL UNIQUE REFERENCES members(id),
    token_hash   TEXT NOT NULL UNIQUE,
    status       TEXT NOT NULL CHECK (status IN ('active','revoked')),
    created_at   TEXT NOT NULL,
    revoked_at   TEXT,
    last_used_at TEXT
  ) STRICT`,
  `CREATE TABLE auth_sessions (
    session_id    TEXT PRIMARY KEY,
    member_id     TEXT NOT NULL REFERENCES members(id),
    share_link_id TEXT NOT NULL REFERENCES share_links(id),
    verifier_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    last_seen_at  TEXT NOT NULL
  ) STRICT`,
  `CREATE TABLE network_config (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    format_version INTEGER NOT NULL,
    enabled        INTEGER NOT NULL CHECK (enabled IN (0,1)),
    host           TEXT,
    port           INTEGER CHECK (port IS NULL OR port BETWEEN 1 AND 65535),
    share_base_url TEXT
  ) STRICT`,
  `CREATE TABLE schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    checksum    TEXT NOT NULL,
    applied_at  TEXT NOT NULL,
    app_version TEXT NOT NULL
  ) STRICT`,
] as const;

/** 查询索引（06 §5.3）；唯一约束已由表内 UNIQUE 建索引。 */
export const INDEX_STATEMENTS: readonly string[] = [
  "CREATE INDEX tasks_folder_idx ON tasks(folder_id, deleted_at)",
  "CREATE INDEX tasks_aggregate_idx ON tasks(aggregate_id)",
  "CREATE INDEX tasks_parent_idx ON tasks(parent_id)",
  "CREATE INDEX assignments_member_idx ON assignments(member_id)",
  "CREATE INDEX assignments_aggregate_idx ON assignments(aggregate_id)",
  "CREATE INDEX task_revisions_range_idx ON task_revisions(aggregate_id, recorded_at DESC, task_version DESC)",
  "CREATE INDEX task_revisions_recorded_idx ON task_revisions(recorded_at)",
  "CREATE INDEX auth_sessions_member_idx ON auth_sessions(member_id)",
  "CREATE INDEX auth_sessions_expiry_idx ON auth_sessions(expires_at)",
  "CREATE INDEX share_links_status_idx ON share_links(status)",
] as const;

/** 初始 migration 的 down：按外键依赖反向删除（仅测试/回滚用）。 */
export const DROP_STATEMENTS: readonly string[] = [
  "DROP TABLE IF EXISTS schema_migrations",
  "DROP TABLE IF EXISTS network_config",
  "DROP TABLE IF EXISTS auth_sessions",
  "DROP TABLE IF EXISTS share_links",
  "DROP TABLE IF EXISTS task_revisions",
  "DROP TABLE IF EXISTS assignments",
  "DROP TABLE IF EXISTS tasks",
  "DROP TABLE IF EXISTS task_aggregates",
  "DROP TABLE IF EXISTS folders",
  "DROP TABLE IF EXISTS members",
  "DROP TABLE IF EXISTS meta",
] as const;
