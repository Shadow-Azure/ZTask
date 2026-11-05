import { readdir } from "node:fs/promises";
import path from "node:path";
import { Kysely, sql } from "kysely";
import { readJsonFile } from "./atomic-json.js";
import { iterateJsonl, recoverJsonlTail } from "./jsonl.js";
import type { DB } from "./db.js";
import type { StoreContextOptions } from "./db.js";
import { StorageCorruptionError } from "./errors.js";
import type { RevisionLine, TaskAggregate } from "./task-types.js";

interface LegacyManifest {
  formatVersion: number;
  applicationVersion: string;
  createdAt: string;
  timeZone: string;
}

interface LegacyNetworkFile {
  formatVersion: number;
  shareListener: {
    enabled: boolean;
    host: string | null;
    port: number | null;
    shareBaseUrl: string | null;
  };
}

interface LegacyMember {
  id: string;
  name: string;
  role: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface LegacyFolder {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

interface LegacyShareLink {
  id: string;
  memberId: string;
  tokenHash: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

interface LegacySession {
  sessionId: string;
  memberId: string;
  shareLinkId: string;
  verifierHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

interface LegacyTaskSnapshot {
  task: TaskAggregate["task"];
  subtasks: TaskAggregate["subtasks"];
  assignments: TaskAggregate["assignments"];
}

interface LegacyCurrent extends LegacyTaskSnapshot {
  formatVersion: number;
  taskId: string;
  taskVersion: number;
  updatedAt: string;
  revisionTip: {
    taskVersion: number;
    recordedAt: string;
    changeKind: string;
    checksum: string;
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function assertShape(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StorageCorruptionError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readManifest(dataDir: string): Promise<LegacyManifest> {
  const value = await readJsonFile(path.join(dataDir, "manifest.json"));
  assertShape(isRecord(value), "旧 manifest.json 不是对象");
  const manifest = value as unknown as LegacyManifest;
  assertShape(typeof manifest.formatVersion === "number", "旧 manifest.formatVersion 非法");
  assertShape(typeof manifest.applicationVersion === "string", "旧 manifest.applicationVersion 非法");
  assertShape(typeof manifest.createdAt === "string", "旧 manifest.createdAt 非法");
  assertShape(typeof manifest.timeZone === "string" && manifest.timeZone !== "", "旧 manifest.timeZone 非法");
  return manifest;
}

async function importMembers(db: Kysely<DB>, dataDir: string, fallback: string): Promise<number> {
  const dir = path.join(dataDir, "members");
  let count = 0;
  for (const name of (await readNames(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const id = name.slice(0, -".json".length);
    const value = await readJsonFile(path.join(dir, name));
    assertShape(isRecord(value), `成员文件不是对象：${name}`);
    const member = value as unknown as LegacyMember;
    assertShape(member.id === id, `成员 id 与文件名不一致：${name}`);
    await db
      .insertInto("members")
      .values({
        id: member.id,
        name: member.name,
        role: member.role ?? "",
        color: member.color ?? "#9aa2ae",
        created_at: member.createdAt ?? fallback,
        updated_at: member.updatedAt ?? member.createdAt ?? fallback,
        archived_at: member.archivedAt ?? null,
      })
      .execute();
    count += 1;
  }
  return count;
}

async function importFolders(db: Kysely<DB>, dataDir: string, fallback: string): Promise<number> {
  const dir = path.join(dataDir, "folders");
  let count = 0;
  for (const name of (await readNames(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const id = name.slice(0, -".json".length);
    const value = await readJsonFile(path.join(dir, name));
    assertShape(isRecord(value), `任务夹文件不是对象：${name}`);
    const folder = value as unknown as LegacyFolder;
    assertShape(folder.id === id, `任务夹 id 与文件名不一致：${name}`);
    await db
      .insertInto("folders")
      .values({
        id: folder.id,
        parent_id: folder.parentId ?? null,
        name: folder.name,
        position: folder.position ?? 0,
        created_at: folder.createdAt ?? fallback,
        updated_at: folder.updatedAt ?? folder.createdAt ?? fallback,
        deleted_at: folder.deletedAt ?? null,
      })
      .execute();
    count += 1;
  }
  return count;
}

async function importShareLinks(db: Kysely<DB>, dataDir: string, fallback: string): Promise<number> {
  const dir = path.join(dataDir, "share-links");
  let count = 0;
  for (const name of (await readNames(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const key = name.slice(0, -".json".length);
    const value = await readJsonFile(path.join(dir, name));
    assertShape(isRecord(value), `分享链接文件不是对象：${name}`);
    const link = value as unknown as LegacyShareLink;
    assertShape(link.memberId === key, `分享链接文件名与 memberId 不一致：${name}`);
    await db
      .insertInto("share_links")
      .values({
        id: link.id,
        member_id: link.memberId,
        token_hash: link.tokenHash,
        status: link.status,
        created_at: link.createdAt ?? fallback,
        revoked_at: link.revokedAt ?? null,
        last_used_at: link.lastUsedAt ?? null,
      })
      .execute();
    count += 1;
  }
  return count;
}

async function importSessions(db: Kysely<DB>, dataDir: string, fallback: string): Promise<number> {
  const dir = path.join(dataDir, "auth-sessions");
  let count = 0;
  for (const name of (await readNames(dir)).filter((entry) => entry.endsWith(".json")).sort()) {
    const key = name.slice(0, -".json".length);
    const value = await readJsonFile(path.join(dir, name));
    assertShape(isRecord(value), `认证会话文件不是对象：${name}`);
    const session = value as unknown as LegacySession;
    assertShape(session.sessionId === key, `认证会话文件名与 sessionId 不一致：${name}`);
    await db
      .insertInto("auth_sessions")
      .values({
        session_id: session.sessionId,
        member_id: session.memberId,
        share_link_id: session.shareLinkId,
        verifier_hash: session.verifierHash,
        created_at: session.createdAt ?? fallback,
        expires_at: session.expiresAt ?? fallback,
        last_seen_at: session.lastSeenAt ?? session.createdAt ?? fallback,
      })
      .execute();
    count += 1;
  }
  return count;
}

async function importNetwork(db: Kysely<DB>, dataDir: string): Promise<void> {
  const file = path.join(dataDir, "network.json");
  let network: LegacyNetworkFile | null = null;
  try {
    const value = await readJsonFile(file);
    assertShape(isRecord(value), "network.json 不是对象");
    network = value as unknown as LegacyNetworkFile;
  } catch (cause) {
    if ((cause as Error).name !== "EntryNotFoundError") throw cause;
  }
  const listener = network?.shareListener;
  await db
    .insertInto("network_config")
    .values({
      id: 1,
      format_version: network?.formatVersion ?? 1,
      enabled: listener?.enabled ? 1 : 0,
      host: listener?.host ?? null,
      port: listener?.port ?? null,
      share_base_url: listener?.shareBaseUrl ?? null,
    })
    .execute();
}

async function importTask(
  db: Kysely<DB>,
  dataDir: string,
  taskId: string,
): Promise<{ revisions: number; hasCurrent: boolean }> {
  const taskDir = path.join(dataDir, "tasks", taskId);
  const revisionsPath = path.join(taskDir, "revisions.jsonl");
  await recoverJsonlTail(revisionsPath);

  let current: LegacyCurrent | null = null;
  try {
    const value = await readJsonFile(path.join(taskDir, "current.json"));
    assertShape(isRecord(value), `current.json 不是对象：${taskId}`);
    current = value as unknown as LegacyCurrent;
    assertShape(current.taskId === taskId, `current.taskId 与目录不一致：${taskId}`);
  } catch (cause) {
    if ((cause as Error).name !== "EntryNotFoundError") throw cause;
  }

  const revisions: RevisionLine[] = [];
  try {
    await iterateJsonl(revisionsPath, (record) => {
      revisions.push(record as unknown as RevisionLine);
    });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
  }

  if (revisions.length === 0) {
    if (current !== null) {
      throw new StorageCorruptionError(`current 存在但 revisions 为空（历史缺失）：${taskId}`);
    }
    return { revisions: 0, hasCurrent: false };
  }

  const last = revisions[revisions.length - 1]!;
  assertShape(last.taskId === taskId, `revision.taskId 与聚合不一致：${taskId}`);
  for (const [index, revision] of revisions.entries()) {
    assertShape(
      revision.taskVersion === index + 1,
      `revision taskVersion 不连续：${taskId} 第 ${index + 1} 行`,
    );
  }
  if (current !== null) {
    assertShape(
      current.taskVersion <= last.taskVersion,
      `current.taskVersion ${current.taskVersion} 领先 revision ${last.taskVersion}：${taskId}`,
    );
    if (current.taskVersion === last.taskVersion) {
      assertShape(
        isRecord(current.revisionTip) &&
          current.revisionTip.taskVersion === last.taskVersion &&
          current.revisionTip.checksum === last.checksum,
        `current.revisionTip 与最新 revision 不一致：${taskId}`,
      );
    }
  }

  const snapshot: LegacyTaskSnapshot =
    current !== null && current.taskVersion === last.taskVersion
      ? { task: current.task, subtasks: current.subtasks, assignments: current.assignments }
      : { task: last.snapshot.task, subtasks: last.snapshot.subtasks, assignments: last.snapshot.assignments };

  await db
    .insertInto("task_aggregates")
    .values({
      task_id: taskId,
      format_version: last.formatVersion,
      task_version: last.taskVersion,
      updated_at: last.recordedAt,
      tip_revision_id: last.revisionId,
      tip_task_version: last.taskVersion,
      tip_recorded_at: last.recordedAt,
      tip_change_kind: last.changeKind,
      tip_checksum: last.checksum,
    })
    .execute();

  for (const revision of revisions) {
    await db
      .insertInto("task_revisions")
      .values({
        revision_id: revision.revisionId,
        aggregate_id: taskId,
        format_version: revision.formatVersion,
        task_version: revision.taskVersion,
        recorded_at: revision.recordedAt,
        change_kind: revision.changeKind,
        actor_kind: revision.actor.kind,
        actor_member_id: revision.actor.memberId,
        actor_name: revision.actor.name,
        checksum: revision.checksum,
        snapshot_json: JSON.stringify(revision.snapshot),
      })
      .execute();
  }

  await db
    .insertInto("tasks")
    .values({
      id: taskId,
      aggregate_id: taskId,
      parent_id: null,
      folder_id: snapshot.task.folderId,
      description: snapshot.task.description,
      progress: snapshot.task.progress,
      detail_text: snapshot.task.detailText,
      importance: snapshot.task.importance,
      due_date: snapshot.task.dueDate,
      created_at: snapshot.task.createdAt,
      deleted_at: snapshot.task.deletedAt,
    })
    .execute();

  for (const subtask of snapshot.subtasks) {
    await db
      .insertInto("tasks")
      .values({
        id: subtask.id,
        aggregate_id: taskId,
        parent_id: subtask.parentId,
        folder_id: subtask.folderId,
        description: subtask.description,
        progress: subtask.progress,
        detail_text: null,
        importance: subtask.importance,
        due_date: subtask.dueDate,
        created_at: subtask.createdAt,
        deleted_at: subtask.deletedAt,
      })
      .execute();
  }

  for (const assignment of snapshot.assignments) {
    await db
      .insertInto("assignments")
      .values({
        task_id: assignment.taskId,
        aggregate_id: taskId,
        member_id: assignment.memberId,
        kind: assignment.kind,
      })
      .execute();
  }

  return { revisions: revisions.length, hasCurrent: true };
}

/**
 * 把旧分聚合 JSON/JSONL 数据一次性导入已建好 schema 的空 SQLite 库。
 *
 * 导入在一个事务内完成；任何 checksum/引用/版本不一致都抛错回滚，旧文件保持原样。
 * 调用方负责在建库前判断 `manifest.json` 存在，并在成功后移动旧文件。
 * @param db 已应用 migration 的连接。
 * @param dataDir 旧数据目录。
 * @param options 应用版本/时区/时钟。
 */
export async function importLegacyData(
  db: Kysely<DB>,
  dataDir: string,
  options: StoreContextOptions,
): Promise<void> {
  const manifest = await readManifest(dataDir);
  const now = (options.clock ?? (() => new Date()))().toISOString();

  let members = 0;
  let folders = 0;
  let links = 0;
  let sessions = 0;
  let tasks = 0;

  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("meta")
      .values([
        { key: "application_version", value: manifest.applicationVersion },
        { key: "created_at", value: manifest.createdAt },
        { key: "time_zone", value: options.timeZone ?? manifest.timeZone },
        { key: "legacy_imported_at", value: now },
        { key: "legacy_format_version", value: String(manifest.formatVersion) },
      ])
      .execute();

    members = await importMembers(trx, dataDir, manifest.createdAt);
    folders = await importFolders(trx, dataDir, manifest.createdAt);

    const taskNames = (await readNames(path.join(dataDir, "tasks"))).filter((name) => UUID_PATTERN.test(name));
    for (const taskId of taskNames.sort()) {
      const result = await importTask(trx, dataDir, taskId);
      if (result.hasCurrent) tasks += 1;
    }

    links = await importShareLinks(trx, dataDir, manifest.createdAt);
    sessions = await importSessions(trx, dataDir, manifest.createdAt);
    await importNetwork(trx, dataDir);

    // 计数与引用闭合：外键在 commit 时检查；这里额外确认每条任务都写入了聚合。
    const aggregateCount = await trx
      .selectFrom("task_aggregates")
      .select((expression) => expression.fn.countAll<number>().as("count"))
      .executeTakeFirst();
    assertShape(Number(aggregateCount?.count ?? 0) === tasks, "导入的任务聚合数与旧目录不一致");
  });

  const counts = {
    members,
    folders,
    tasks,
    links,
    sessions,
  };
  void counts;

  const fk = await sql<Record<string, unknown>>`PRAGMA foreign_key_check`.execute(db);
  if (fk.rows.length > 0) {
    throw new StorageCorruptionError(`旧数据导入后外键校验失败：${JSON.stringify(fk.rows.slice(0, 3))}`);
  }
}
