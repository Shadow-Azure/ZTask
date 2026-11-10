import type { Kysely } from "kysely";
import { getStoreContext } from "./db.js";
import { StorageError } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 单实体存储接口：members/folders/share-links/auth-sessions 继续沿用
 * “按 id 读取/整体 upsert/列出”的语义，底层由 SQLite 表实现（06 §4）。
 */
export interface EntityStore<T> {
  /** 读取实体；不存在返回 null。 */
  get(id: string): Promise<T | null>;
  /** 原子写入实体（创建或整体替换）。 */
  put(id: string, value: T): Promise<void>;
  /** 列出全部实体（按主键稳定排序）。 */
  list(): Promise<Array<{ id: string; value: T }>>;
}

interface EntityAdapter<T> {
  table: string;
  key: string;
  toRow(id: string, value: T): Record<string, unknown>;
  toValue(row: Record<string, unknown>): T;
  keyFromRow(row: Record<string, unknown>): string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

const MEMBERS: EntityAdapter<Record<string, unknown>> = {
  table: "members",
  key: "id",
  toRow(id, value) {
    const now = new Date().toISOString();
    return {
      id,
      name: value.name ?? "",
      role: value.role ?? "",
      color: value.color ?? "#9aa2ae",
      is_admin: value.isAdmin === true ? 1 : 0,
      created_at: value.createdAt ?? now,
      updated_at: value.updatedAt ?? value.createdAt ?? now,
      archived_at: value.archivedAt ?? null,
    };
  },
  toValue(row) {
    return {
      formatVersion: 1,
      id: row.id,
      name: row.name,
      role: row.role,
      color: row.color,
      isAdmin: row.is_admin === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
    };
  },
  keyFromRow(row) {
    return String(row.id);
  },
};

const FOLDERS: EntityAdapter<Record<string, unknown>> = {
  table: "folders",
  key: "id",
  toRow(id, value) {
    const now = new Date().toISOString();
    return {
      id,
      parent_id: value.parentId ?? null,
      name: value.name ?? "",
      position: value.position ?? 0,
      created_at: value.createdAt ?? now,
      updated_at: value.updatedAt ?? value.createdAt ?? now,
      deleted_at: value.deletedAt ?? null,
    };
  },
  toValue(row) {
    return {
      formatVersion: 1,
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      position: row.position,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    };
  },
  keyFromRow(row) {
    return String(row.id);
  },
};

const SHARE_LINKS: EntityAdapter<Record<string, unknown>> = {
  table: "share_links",
  key: "member_id",
  toRow(id, value) {
    return {
      id: value.id,
      member_id: id,
      token_hash: value.tokenHash,
      status: value.status,
      created_at: value.createdAt,
      revoked_at: value.revokedAt ?? null,
      last_used_at: value.lastUsedAt ?? null,
    };
  },
  toValue(row) {
    return {
      formatVersion: 1,
      id: row.id,
      memberId: row.member_id,
      tokenHash: row.token_hash,
      status: row.status,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      lastUsedAt: row.last_used_at,
    };
  },
  keyFromRow(row) {
    return String(row.member_id);
  },
};

const AUTH_SESSIONS: EntityAdapter<Record<string, unknown>> = {
  table: "auth_sessions",
  key: "session_id",
  toRow(id, value) {
    return {
      session_id: id,
      member_id: value.memberId,
      share_link_id: value.shareLinkId,
      verifier_hash: value.verifierHash,
      created_at: value.createdAt,
      expires_at: value.expiresAt,
      last_seen_at: value.lastSeenAt,
    };
  },
  toValue(row) {
    return {
      formatVersion: 1,
      sessionId: row.session_id,
      memberId: row.member_id,
      shareLinkId: row.share_link_id,
      verifierHash: row.verifier_hash,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
    };
  },
  keyFromRow(row) {
    return String(row.session_id);
  },
};

function adapterFor(subdir: string): EntityAdapter<Record<string, unknown>> {
  switch (subdir) {
    case "members":
      return MEMBERS;
    case "folders":
      return FOLDERS;
    case "share-links":
      return SHARE_LINKS;
    case "auth-sessions":
      return AUTH_SESSIONS;
    default:
      throw new StorageError("UNKNOWN_ENTITY_TABLE", `未知实体目录：${subdir}`);
  }
}

/**
 * 创建 SQLite 实体存储。ID 仍要求服务端 UUID——表键不接受用户输入。
 * @param options 装配项：数据目录与实体种类（沿用旧子目录名）。
 * @param options.dataDir 数据目录根。
 * @param options.subdir members/folders/share-links/auth-sessions。
 * @returns EntityStore 实例。
 */
export function createEntityStore<T>(options: { dataDir: string; subdir: string }): EntityStore<T> {
  const adapter = adapterFor(options.subdir);

  function assertId(id: string): void {
    if (!UUID_PATTERN.test(id)) {
      throw new StorageError("INVALID_ENTITY_ID", `实体 ID 非法（须为 UUID）：${id}`);
    }
  }

  return {
    async get(id: string): Promise<T | null> {
      assertId(id);
      const context = await getStoreContext(options.dataDir);
      const db = context.db as unknown as Kysely<Record<string, unknown>>;
      const row = await db
        .selectFrom(adapter.table as never)
        .selectAll()
        .where(adapter.key as never, "=" as never, id as never)
        .executeTakeFirst();
      return row ? (adapter.toValue(row as Record<string, unknown>) as T) : null;
    },

    async put(id: string, value: T): Promise<void> {
      assertId(id);
      const context = await getStoreContext(options.dataDir);
      const db = context.db as unknown as Kysely<Record<string, unknown>>;
      const row = adapter.toRow(id, asRecord(value));
      await db
        .insertInto(adapter.table as never)
        .values(row as never)
        .onConflict((oc) => oc.column(adapter.key as never).doUpdateSet(row as never))
        .execute();
    },

    async list(): Promise<Array<{ id: string; value: T }>> {
      const context = await getStoreContext(options.dataDir);
      const db = context.db as unknown as Kysely<Record<string, unknown>>;
      const rows = await db
        .selectFrom(adapter.table as never)
        .selectAll()
        .orderBy(adapter.key as never)
        .execute();
      return rows.map((row) => ({
        id: adapter.keyFromRow(row as Record<string, unknown>),
        value: adapter.toValue(row as Record<string, unknown>) as T,
      }));
    },
  };
}
