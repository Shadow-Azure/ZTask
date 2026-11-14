import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Kysely, SqliteDialect, sql } from "kysely";
import { StorageCorruptionError, UnsupportedFormatError } from "./errors.js";
import type { Manifest } from "./manifest-store.js";
import { runMigrations } from "./migrations.js";
import { importLegacyData } from "./legacy-import.js";
import { SCHEMA_VERSION } from "./migrations.js";

/** `meta` 表行；值为文本，应用层负责序列化。 */
export interface MetaRow {
  key: string;
  value: string;
}

/** 成员当前状态行（06 §4.2）。 */
export interface MemberRow {
  id: string;
  name: string;
  role: string;
  color: string;
  /** 管理员权限（0/1）；v2 migration 新增。 */
  is_admin: number;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

/** 任务夹当前状态行。 */
export interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** 主任务聚合版本与 revision tip。 */
export interface TaskAggregateRow {
  task_id: string;
  format_version: number;
  task_version: number;
  updated_at: string;
  tip_revision_id: string;
  tip_task_version: number;
  tip_recorded_at: string;
  tip_change_kind: string;
  tip_checksum: string;
}

/** 主任务与小任务当前状态行。 */
export interface TaskRow {
  id: string;
  aggregate_id: string;
  parent_id: string | null;
  folder_id: string;
  description: string;
  progress: number;
  detail_text: string | null;
  /** 方案描述（m18 v3 migration 新增，主任务专用；小任务恒为 null）。 */
  plan_text: string | null;
  importance: string;
  due_date: string | null;
  created_at: string;
  deleted_at: string | null;
}

/** 任务分配行。 */
export interface AssignmentRow {
  task_id: string;
  aggregate_id: string;
  member_id: string;
  kind: string;
}

/** 不可变历史快照行。 */
export interface TaskRevisionRow {
  revision_id: string;
  aggregate_id: string;
  format_version: number;
  task_version: number;
  recorded_at: string;
  change_kind: string;
  actor_kind: string;
  actor_member_id: string | null;
  actor_name: string;
  checksum: string;
  snapshot_json: string;
}

/** 分享链接行（每成员最多一条）。 */
export interface ShareLinkRow {
  id: string;
  member_id: string;
  token_hash: string;
  status: string;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

/** 成员认证会话行。 */
export interface AuthSessionRow {
  session_id: string;
  member_id: string;
  share_link_id: string;
  verifier_hash: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

/** 期望恢复的 LAN 配置（单行）。 */
export interface NetworkConfigRow {
  id: number;
  format_version: number;
  enabled: number;
  host: string | null;
  port: number | null;
  share_base_url: string | null;
}

/** 已应用 migration 的审计行；执行状态由 Kysely 的 `kysely_migration` 管理。 */
export interface SchemaMigrationRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
  app_version: string;
}

/** Kysely 数据库类型；表名与 `schema.ts` 的 DDL 一一对应。 */
export interface DB {
  meta: MetaRow;
  members: MemberRow;
  folders: FolderRow;
  task_aggregates: TaskAggregateRow;
  tasks: TaskRow;
  assignments: AssignmentRow;
  task_revisions: TaskRevisionRow;
  share_links: ShareLinkRow;
  auth_sessions: AuthSessionRow;
  network_config: NetworkConfigRow;
  schema_migrations: SchemaMigrationRow;
  kysely_migration: { name: string; timestamp: string };
  kysely_migration_lock: { id: string; is_locked: number };
}

/** 一个数据目录的 SQLite 上下文；同一目录在进程内共享同一连接。 */
export interface StoreContext {
  dataDir: string;
  dbPath: string;
  db: Kysely<DB>;
  raw: InstanceType<typeof Database>;
  manifest: Manifest;
}

/** getStoreContext 的可选装配项；仅首次建库、旧文件导入或更新 meta 时使用。 */
export interface StoreContextOptions {
  /** 最近一次打开数据库的应用版本。 */
  applicationVersion?: string;
  /** 首次建库时写入的团队时区；已有库保留原值。 */
  timeZone?: string;
  /** 可注入时钟（建库/导入时间戳）。 */
  clock?: () => Date;
}

const contexts = new Map<string, Promise<StoreContext>>();

/**
 * 数据目录是否已经有 SQLite 库；用于 maintenance/network 的 legacy 分支判断。
 * @param dataDir 数据目录。
 * @returns 存在 ztask.db 时为 true。
 */
export function hasStoreDb(dataDir: string): boolean {
  return existsSync(path.join(path.resolve(dataDir), "ztask.db"));
}

/**
 * 数据库文件路径。
 * @param dataDir 数据目录。
 * @returns ztask.db 的绝对路径。
 */
export function storeDbPath(dataDir: string): string {
  return path.join(path.resolve(dataDir), "ztask.db");
}

async function ensureDataDir(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  for (const sub of ["locks", "backups", "tmp"] as const) {
    await mkdir(path.join(dataDir, sub), { recursive: true, mode: 0o700 });
  }
}

function openDb(dbPath: string): { db: Kysely<DB>; raw: InstanceType<typeof Database> } {
  const raw = new Database(dbPath);
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: raw }) });
  return { db, raw };
}

/**
 * 打开一个仅用于诊断的连接；`query_only` 阻止应用写路径，WAL 库无需只读重开。
 * @param dbPath ztask.db 路径。
 * @returns Kysely 连接与原生句柄。
 */
export function openDiagnosticDb(dbPath: string): {
  db: Kysely<DB>;
  raw: InstanceType<typeof Database>;
} {
  const raw = new Database(dbPath);
  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: raw }) });
  return { db, raw };
}

async function applyPragmas(db: Kysely<DB>): Promise<void> {
  await sql`PRAGMA journal_mode = WAL`.execute(db);
  await sql`PRAGMA synchronous = FULL`.execute(db);
  await sql`PRAGMA foreign_keys = ON`.execute(db);
  await sql`PRAGMA busy_timeout = 5000`.execute(db);
  await sql`PRAGMA trusted_schema = OFF`.execute(db);
  await sql`PRAGMA wal_autocheckpoint = 1000`.execute(db);
}

/**
 * 读取 `PRAGMA user_version`。
 * @param db Kysely 连接。
 * @returns schema 版本号。
 */
export async function readUserVersion(db: Kysely<DB>): Promise<number> {
  const result = await sql<{ user_version: number }>`PRAGMA user_version`.execute(db);
  return Number(result.rows[0]?.user_version ?? 0);
}

/**
 * 读取 `meta` 表为键值对象。
 * @param db Kysely 连接。
 * @returns meta 键值。
 */
export async function readMeta(db: Kysely<DB>): Promise<Record<string, string>> {
  const rows = await db.selectFrom("meta").selectAll().execute();
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * 写一条 `meta`（存在则覆盖）。
 * @param db Kysely 连接。
 * @param key meta 键。
 * @param value meta 值。
 * @returns 写完的 Promise。
 */
export async function writeMeta(db: Kysely<DB>, key: string, value: string): Promise<void> {
  await db
    .insertInto("meta")
    .values({ key, value })
    .onConflict((oc) => oc.column("key").doUpdateSet({ value }))
    .execute();
}

/**
 * 从 meta 构造与旧 Manifest 形状兼容的视图；`formatVersion` 表示 schema 版本。
 * @param meta meta 键值。
 * @param schemaVersion schema 版本，缺省为当前版本。
 * @returns Manifest 视图。
 */
export function manifestFromMeta(meta: Record<string, string>, schemaVersion = SCHEMA_VERSION): Manifest {
  return {
    formatVersion: schemaVersion,
    applicationVersion: meta.application_version ?? "0.0.0",
    createdAt: meta.created_at ?? new Date(0).toISOString(),
    timeZone: meta.time_zone ?? "UTC",
  };
}

async function checkQuick(db: Kysely<DB>): Promise<void> {
  const result = await sql<{ quick_check: string }>`PRAGMA quick_check`.execute(db);
  const bad = result.rows.filter((row) => row.quick_check !== "ok");
  if (bad.length > 0) {
    throw new StorageCorruptionError(`数据库 quick_check 未通过：${bad.map((row) => row.quick_check).join("; ")}`);
  }
}

async function checkForeignKeys(db: Kysely<DB>): Promise<void> {
  const result = await sql<Record<string, unknown>>`PRAGMA foreign_key_check`.execute(db);
  if (result.rows.length > 0) {
    throw new StorageCorruptionError(`数据库外键校验未通过：${JSON.stringify(result.rows.slice(0, 3))}`);
  }
}

async function chmodBestEffort(filePath: string): Promise<void> {
  try {
    await chmod(filePath, 0o600);
  } catch {
    // Windows 或只读文件系统不强制 mode；错误留给实际读写。
  }
}

async function closeQuietly(db: Kysely<DB>, raw: InstanceType<typeof Database>): Promise<void> {
  await db.destroy().catch(() => undefined);
  try {
    raw.close();
  } catch {
    // destroy 已关闭时忽略。
  }
}

async function removeDbFiles(dbPath: string): Promise<void> {
  for (const suffix of ["", "-wal", "-shm"]) {
    await rm(`${dbPath}${suffix}`, { force: true }).catch(() => undefined);
  }
}

async function readLegacyLeftovers(dataDir: string): Promise<string[]> {
  const names = await readdir(dataDir).catch(() => [] as string[]);
  const business = new Set([
    "manifest.json",
    "network.json",
    "members",
    "folders",
    "tasks",
    "share-links",
    "auth-sessions",
  ]);
  return names.filter((name) => business.has(name));
}

async function moveLegacyFiles(dataDir: string): Promise<void> {
  const leftovers = await readLegacyLeftovers(dataDir);
  if (leftovers.length === 0) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(dataDir, "backups", `pre-sqlite-${stamp}`);
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const name of leftovers) {
    await rename(path.join(dataDir, name), path.join(target, name));
  }
}

async function writeDefaultNetwork(db: Kysely<DB>): Promise<void> {
  const existing = await db.selectFrom("network_config").select("id").where("id", "=", 1).executeTakeFirst();
  if (existing) return;
  await db
    .insertInto("network_config")
    .values({
      id: 1,
      format_version: 1,
      enabled: 0,
      host: null,
      port: null,
      share_base_url: null,
    })
    .execute();
}

async function ensureMeta(
  db: Kysely<DB>,
  options: StoreContextOptions,
): Promise<Record<string, string>> {
  const meta = await readMeta(db);
  const now = (options.clock ?? (() => new Date()))().toISOString();
  if (!meta.created_at) await writeMeta(db, "created_at", now);
  if (!meta.time_zone) {
    await writeMeta(db, "time_zone", options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  }
  if (!meta.application_version) {
    await writeMeta(db, "application_version", options.applicationVersion ?? "0.0.0");
  } else if (options.applicationVersion !== undefined && meta.application_version !== options.applicationVersion) {
    await writeMeta(db, "application_version", options.applicationVersion);
  }
  return await readMeta(db);
}

async function openStoreContext(dataDir: string, options: StoreContextOptions): Promise<StoreContext> {
  await ensureDataDir(dataDir);
  const dbPath = path.join(dataDir, "ztask.db");
  const existed = existsSync(dbPath);
  const hasLegacyManifest = existsSync(path.join(dataDir, "manifest.json"));
  const { db, raw } = openDb(dbPath);

  try {
    await applyPragmas(db);

    if (existed && hasLegacyManifest) {
      const meta = await readMeta(db);
      if (!meta.legacy_imported_at) {
        throw new StorageCorruptionError(
          "数据目录同时存在 ztask.db 与旧 manifest.json；请保留其中一个（旧文件可移入 backups/）后再启动",
        );
      }
    }

    if (!existed) {
      await runMigrations(db, options.applicationVersion ?? "0.0.0");
      if (hasLegacyManifest) {
        await importLegacyData(db, dataDir, options);
        await moveLegacyFiles(dataDir);
      } else {
        await ensureMeta(db, options);
        await writeDefaultNetwork(db);
      }
    } else {
      const currentVersion = await readUserVersion(db);
      if (currentVersion > SCHEMA_VERSION) {
        throw new UnsupportedFormatError(
          `数据库 schema 版本 ${currentVersion} 高于应用支持的 ${SCHEMA_VERSION}，请先升级应用`,
        );
      }
      await runMigrations(db, options.applicationVersion ?? "0.0.0");
      await ensureMeta(db, options);
      await writeDefaultNetwork(db);
      if (hasLegacyManifest) {
        // 已成功导入过的旧目录残留：DB 是权威来源，尽力移走旧文件。
        await moveLegacyFiles(dataDir).catch(() => undefined);
      }
    }

    await checkQuick(db);
    await checkForeignKeys(db);
    const meta = await ensureMeta(db, options);
    const manifest = manifestFromMeta(meta, await readUserVersion(db));
    await chmodBestEffort(dbPath);
    for (const suffix of ["-wal", "-shm"]) await chmodBestEffort(`${dbPath}${suffix}`);

    return { dataDir, dbPath, db, raw, manifest };
  } catch (cause) {
    await closeQuietly(db, raw);
    if (!existed) await removeDbFiles(dbPath);
    throw cause;
  }
}

/**
 * 取得（必要时创建/导入/迁移）一个数据目录的 SQLite 上下文。
 *
 * 同一路径的并发调用共享同一个打开过程；失败后缓存清除，允许重试。
 * @param dataDir 数据目录。
 * @param options 应用版本、团队时区与时钟（首次建库/导入时使用）。
 * @returns StoreContext。
 */
export async function getStoreContext(dataDir: string, options: StoreContextOptions = {}): Promise<StoreContext> {
  const key = path.resolve(dataDir);
  const existing = contexts.get(key);
  if (existing) return await existing;
  const opening = openStoreContext(key, options);
  contexts.set(key, opening);
  try {
    return await opening;
  } catch (cause) {
    contexts.delete(key);
    throw cause;
  }
}

/**
 * checkpoint 并关闭数据目录连接；幂等。优雅关闭/测试清理时调用。
 * @param dataDir 数据目录。
 */
export async function closeStoreContext(dataDir: string): Promise<void> {
  const key = path.resolve(dataDir);
  const opening = contexts.get(key);
  if (!opening) return;
  contexts.delete(key);
  const context = await opening.catch(() => null);
  if (!context) return;
  await sql`PRAGMA wal_checkpoint(TRUNCATE)`.execute(context.db).catch(() => undefined);
  await context.db.destroy();
  try {
    context.raw.close();
  } catch {
    // Kysely 的 destroy 可能已经关闭原生连接。
  }
}

/**
 * 读取数据库文件的字节数（备份报告/doctor 统计用）。
 * @param dataDir 数据目录。
 * @returns 文件字节数；缺失为 0。
 */
export async function databaseSize(dataDir: string): Promise<number> {
  try {
    return (await stat(storeDbPath(dataDir))).size;
  } catch {
    return 0;
  }
}
