import { createHash } from "node:crypto";
import { Kysely, sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import { StorageCorruptionError } from "./errors.js";
import { DDL_STATEMENTS, DROP_STATEMENTS, INDEX_STATEMENTS } from "./schema.js";
import type { DB } from "./db.js";

/** 应用支持的 SQLite schema 版本；migration 只能追加，不能改已发布项。 */
export const SCHEMA_VERSION = 1;

const INITIAL_STATEMENTS = [...DDL_STATEMENTS, ...INDEX_STATEMENTS];

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** migration 的校验和：覆盖该版本的全部 DDL，发布后修改会导致启动拒绝。 */
const CHECKSUMS: Record<string, string> = {
  "0001_initial": sha256(INITIAL_STATEMENTS.join(";\n")),
};

const MIGRATIONS: Record<string, Migration> = {
  "0001_initial": {
    async up(db): Promise<void> {
      for (const statement of INITIAL_STATEMENTS) {
        await sql.raw(statement).execute(db);
      }
    },
    async down(db): Promise<void> {
      for (const statement of DROP_STATEMENTS) {
        await sql.raw(statement).execute(db);
      }
    },
  },
};

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return MIGRATIONS;
  }
}

async function readAppliedNames(db: Kysely<DB>): Promise<string[]> {
  try {
    const rows = await db.selectFrom("kysely_migration").select("name").orderBy("name").execute();
    return rows.map((row) => row.name);
  } catch {
    // 首次 migration 前 Kysely 的迁移表尚未创建。
    return [];
  }
}

async function readAudit(db: Kysely<DB>): Promise<Array<{ name: string; checksum: string }>> {
  try {
    return await db.selectFrom("schema_migrations").select(["name", "checksum"]).execute();
  } catch {
    return [];
  }
}

function checksumFor(name: string): string {
  const checksum = CHECKSUMS[name];
  if (checksum === undefined) throw new StorageCorruptionError(`未知 migration：${name}`);
  return checksum;
}

/**
 * 执行待应用 migration，并维护 `schema_migrations` 审计与 `PRAGMA user_version`。
 *
 * Kysely 的 `kysely_migration` 是执行状态；本函数额外保存每个已应用 migration
 * 的 checksum，防止发布后修改历史 migration。未知 migration（应用太旧/被篡改）
 * 直接拒绝启动。
 * @param db 已打开的 Kysely 连接。
 * @param appVersion 当前应用版本（写入审计行）。
 */
export async function runMigrations(db: Kysely<DB>, appVersion: string): Promise<void> {
  const appliedBefore = await readAppliedNames(db);
  const known = new Set(Object.keys(MIGRATIONS));
  for (const name of appliedBefore) {
    if (!known.has(name)) {
      throw new StorageCorruptionError(
        `数据库包含当前应用不认识的 migration：${name}；请升级应用或从备份恢复`,
      );
    }
  }

  const migrator = new Migrator({ db, provider: new StaticMigrationProvider() });
  const { error } = await migrator.migrateToLatest();
  if (error) {
    throw error instanceof Error ? error : new StorageCorruptionError(`migration 失败：${String(error)}`);
  }

  const applied = await readAppliedNames(db);
  const audit = await readAudit(db);
  const auditByName = new Map(audit.map((row) => [row.name, row.checksum]));
  for (const [index, name] of applied.entries()) {
    const checksum = checksumFor(name);
    const previous = auditByName.get(name);
    if (previous !== undefined && previous !== checksum) {
      throw new StorageCorruptionError(
        `migration ${name} 的 checksum 已变化（发布后修改历史 migration）；请恢复原 migration 或新增版本`,
      );
    }
    if (previous === undefined) {
      await db
        .insertInto("schema_migrations")
        .values({
          version: index + 1,
          name,
          checksum,
          applied_at: new Date().toISOString(),
          app_version: appVersion,
        })
        .execute();
    }
  }

  await sql.raw(`PRAGMA user_version = ${SCHEMA_VERSION}`).execute(db);
  const version = await sql<{ user_version: number }>`PRAGMA user_version`.execute(db);
  if (Number(version.rows[0]?.user_version ?? 0) !== SCHEMA_VERSION) {
    throw new StorageCorruptionError("PRAGMA user_version 未能更新到当前 schema 版本");
  }
}
