import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ChangeKind, RevisionActor } from "@ztask/shared";
import { Kysely } from "kysely";
import { canonicalJson, checksumOf } from "./checksum.js";
import { getStoreContext, type DB } from "./db.js";
import { EntryNotFoundError, StorageCorruptionError, StorageError, VersionConflictError } from "./errors.js";
import type {
  AssignmentRecord,
  RevisionLine,
  RevisionTip,
  SubtaskRecord,
  TaskAggregate,
  TaskRecord,
} from "./task-types.js";
import { createWriteQueue, type WriteQueue } from "./write-queue.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertTaskId(taskId: string): void {
  if (!UUID_PATTERN.test(taskId)) {
    throw new StorageError("INVALID_TASK_ID", `taskId 非法（须为 UUID）：${taskId}`);
  }
}

/**
 * 旧文件布局下的聚合目录；仅用于旧数据导入/测试引用，不再是运行时存储。
 * @param dataDir 数据目录。
 * @param taskId 主任务 UUID。
 * @returns 旧聚合目录路径。
 */
export function taskDir(dataDir: string, taskId: string): string {
  return join(dataDir, "tasks", taskId);
}

/**
 * 旧文件布局下的 current.json 路径；仅用于旧数据导入/测试引用。
 * @param dataDir 数据目录。
 * @param taskId 主任务 UUID。
 * @returns 旧 current.json 路径。
 */
export function taskCurrentPath(dataDir: string, taskId: string): string {
  return join(taskDir(dataDir, taskId), "current.json");
}

/**
 * 旧文件布局下的 revisions.jsonl 路径；仅用于旧数据导入/测试引用。
 * @param dataDir 数据目录。
 * @param taskId 主任务 UUID。
 * @returns 旧 revisions.jsonl 路径。
 */
export function taskRevisionsPath(dataDir: string, taskId: string): string {
  return join(taskDir(dataDir, taskId), "revisions.jsonl");
}

interface Draft {
  task: TaskRecord;
  subtasks: SubtaskRecord[];
  assignments: AssignmentRecord[];
}

function buildRevision(
  taskId: string,
  taskVersion: number,
  changeKind: ChangeKind,
  actor: RevisionActor,
  snapshot: Draft,
  recordedAt: string,
): { line: RevisionLine; checksum: string } {
  const base = {
    formatVersion: 1,
    revisionId: randomUUID(),
    taskId,
    taskVersion,
    recordedAt,
    changeKind,
    actor,
    snapshot,
  };
  const checksum = checksumOf(base);
  return { line: { ...base, checksum }, checksum };
}

function aggregateFromParts(
  aggregate: {
    task_id: string;
    format_version: number;
    task_version: number;
    updated_at: string;
    tip_task_version: number;
    tip_recorded_at: string;
    tip_change_kind: string;
    tip_checksum: string;
  },
  task: TaskRecord,
  subtasks: SubtaskRecord[],
  assignments: AssignmentRecord[],
): TaskAggregate {
  return {
    formatVersion: aggregate.format_version,
    taskId: aggregate.task_id,
    taskVersion: aggregate.task_version,
    updatedAt: aggregate.updated_at,
    revisionTip: {
      taskVersion: aggregate.tip_task_version,
      recordedAt: aggregate.tip_recorded_at,
      changeKind: aggregate.tip_change_kind as ChangeKind,
      checksum: aggregate.tip_checksum,
    },
    task,
    subtasks,
    assignments,
  };
}

/** 从 SQLite 读取一个聚合；不存在返回 null，结构损坏抛 StorageCorruptionError。 */
async function readAggregate(db: Kysely<DB>, taskId: string): Promise<TaskAggregate | null> {
  const aggregate = await db
    .selectFrom("task_aggregates")
    .selectAll()
    .where("task_id", "=", taskId)
    .executeTakeFirst();
  if (!aggregate) return null;

  const taskRows = await db
    .selectFrom("tasks")
    .selectAll()
    .where("aggregate_id", "=", taskId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
  const main = taskRows.find((row) => row.parent_id === null);
  if (!main || main.id !== taskId) {
    throw new StorageCorruptionError(`聚合缺少主任务行：${taskId}`);
  }
  if (taskRows.some((row) => row.parent_id !== null && row.parent_id !== taskId)) {
    throw new StorageCorruptionError(`小任务 parent_id 非法：${taskId}`);
  }

  const assignments = await db
    .selectFrom("assignments")
    .selectAll()
    .where("aggregate_id", "=", taskId)
    .orderBy("task_id")
    .orderBy("member_id")
    .execute();

  const task: TaskRecord = {
    folderId: main.folder_id,
    parentId: null,
    description: main.description,
    progress: main.progress,
    detailText: main.detail_text ?? "",
    planText: main.plan_text ?? "",
    importance: main.importance as TaskRecord["importance"],
    dueDate: main.due_date,
    createdAt: main.created_at,
    deletedAt: main.deleted_at,
  };
  const subtasks: SubtaskRecord[] = taskRows
    .filter((row) => row.parent_id !== null)
    .map((row) => ({
      id: row.id,
      parentId: row.parent_id!,
      folderId: row.folder_id,
      description: row.description,
      progress: row.progress,
      importance: row.importance as SubtaskRecord["importance"],
      dueDate: row.due_date,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
    }));
  const assignmentRecords: AssignmentRecord[] = assignments.map((row) => ({
    taskId: row.task_id,
    memberId: row.member_id,
    kind: row.kind as AssignmentRecord["kind"],
  }));

  return aggregateFromParts(aggregate, task, subtasks, assignmentRecords);
}

async function insertRevision(db: Kysely<DB>, line: RevisionLine): Promise<void> {
  await db
    .insertInto("task_revisions")
    .values({
      revision_id: line.revisionId,
      aggregate_id: line.taskId,
      format_version: line.formatVersion,
      task_version: line.taskVersion,
      recorded_at: line.recordedAt,
      change_kind: line.changeKind,
      actor_kind: line.actor.kind,
      actor_member_id: line.actor.memberId,
      actor_name: line.actor.name,
      checksum: line.checksum,
      snapshot_json: JSON.stringify(line.snapshot),
    })
    .execute();
}

async function replaceCurrentRows(db: Kysely<DB>, taskId: string, draft: Draft): Promise<void> {
  await db.deleteFrom("assignments").where("aggregate_id", "=", taskId).execute();
  await db.deleteFrom("tasks").where("aggregate_id", "=", taskId).execute();

  await db
    .insertInto("tasks")
    .values({
      id: taskId,
      aggregate_id: taskId,
      parent_id: null,
      folder_id: draft.task.folderId,
      description: draft.task.description,
      progress: draft.task.progress,
      detail_text: draft.task.detailText,
      plan_text: draft.task.planText,
      importance: draft.task.importance,
      due_date: draft.task.dueDate,
      created_at: draft.task.createdAt,
      deleted_at: draft.task.deletedAt,
    })
    .execute();

  for (const subtask of draft.subtasks) {
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
        plan_text: null,
        importance: subtask.importance,
        due_date: subtask.dueDate,
        created_at: subtask.createdAt,
        deleted_at: subtask.deletedAt,
      })
      .execute();
  }

  for (const assignment of draft.assignments) {
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
}

/** task-store 的故障注入缝：事务内抛错即回滚。 */
export interface TaskStoreHooks {
  /** revision 行插入后触发；抛错即模拟提交前失败。 */
  afterAppend?: (info: { taskId: string; taskVersion: number }) => void;
  /** 当前状态行更新后触发；抛错同样回滚。 */
  afterPublish?: (info: { taskId: string; taskVersion: number }) => void;
}

/** createTaskStore 的装配项：目录、时钟、注入缝与队列。 */
export interface TaskStoreOptions {
  dataDir: string;
  clock?: () => Date;
  hooks?: TaskStoreHooks;
  queue?: WriteQueue;
}

/** 创建聚合的输入。 */
export interface CreateAggregateInput {
  taskId: string;
  task: TaskRecord;
  subtasks: SubtaskRecord[];
  assignments: AssignmentRecord[];
  actor: RevisionActor;
}

/** 提交变更的输入。 */
export interface CommitInput {
  expectedVersion: number;
  changeKind: ChangeKind;
  actor: RevisionActor;
  mutate: (draft: Draft) => void;
}

/** 任务聚合存储门面；SQLite 事务是提交边界，写队列只负责顺序。 */
export interface TaskStore {
  createAggregate(input: CreateAggregateInput): Promise<TaskAggregate>;
  commit(taskId: string, input: CommitInput): Promise<TaskAggregate>;
  readRevisions(taskId: string, visitor: (line: RevisionLine) => void | Promise<void>): Promise<void>;
  listTaskIds(): Promise<string[]>;
  drain(): Promise<void>;
  pauseWrites(): Promise<() => void>;
}

/**
 * 创建 SQLite 任务聚合存储门面。
 * @param options 装配项（dataDir 必填；clock/hooks/queue 可注入）。
 * @returns TaskStore。
 */
export function createTaskStore(options: TaskStoreOptions): TaskStore {
  const { dataDir, clock = () => new Date(), hooks, queue = createWriteQueue() } = options;

  async function create(input: CreateAggregateInput): Promise<TaskAggregate> {
    const context = await getStoreContext(dataDir);
    return await context.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("task_aggregates")
        .select("task_id")
        .where("task_id", "=", input.taskId)
        .executeTakeFirst();
      if (existing) throw new StorageError("TASK_AGGREGATE_EXISTS", `任务聚合已存在：${input.taskId}`);

      const recordedAt = clock().toISOString();
      const draft: Draft = { task: input.task, subtasks: input.subtasks, assignments: input.assignments };
      const { line, checksum } = buildRevision(input.taskId, 1, "create", input.actor, draft, recordedAt);

      await trx
        .insertInto("task_aggregates")
        .values({
          task_id: input.taskId,
          format_version: 1,
          task_version: 1,
          updated_at: recordedAt,
          tip_revision_id: line.revisionId,
          tip_task_version: 1,
          tip_recorded_at: recordedAt,
          tip_change_kind: "create",
          tip_checksum: checksum,
        })
        .execute();
      await insertRevision(trx as unknown as Kysely<DB>, line);
      hooks?.afterAppend?.({ taskId: input.taskId, taskVersion: 1 });
      await replaceCurrentRows(trx as unknown as Kysely<DB>, input.taskId, draft);
      hooks?.afterPublish?.({ taskId: input.taskId, taskVersion: 1 });

      return aggregateFromParts(
        {
          task_id: input.taskId,
          format_version: 1,
          task_version: 1,
          updated_at: recordedAt,
          tip_task_version: 1,
          tip_recorded_at: recordedAt,
          tip_change_kind: "create",
          tip_checksum: checksum,
        },
        input.task,
        input.subtasks,
        input.assignments,
      );
    });
  }

  return {
    async createAggregate(input): Promise<TaskAggregate> {
      assertTaskId(input.taskId);
      return await queue.run(input.taskId, () => create(input));
    },

    async commit(taskId, input): Promise<TaskAggregate> {
      assertTaskId(taskId);
      return await queue.run(taskId, async () => {
        const context = await getStoreContext(dataDir);
        return await context.db.transaction().execute(async (trx) => {
          const current = await readAggregate(trx as unknown as Kysely<DB>, taskId);
          if (!current) throw new EntryNotFoundError(`任务聚合不存在：${taskId}`);
          if (current.taskVersion !== input.expectedVersion) {
            throw new VersionConflictError(
              current.taskVersion,
              `版本冲突：期望 ${input.expectedVersion}，当前 ${current.taskVersion}`,
            );
          }

          const original: Draft = {
            task: current.task,
            subtasks: current.subtasks,
            assignments: current.assignments,
          };
          const draft: Draft = structuredClone(original);
          await input.mutate(draft);
          if (canonicalJson(draft) === canonicalJson(original)) return current;

          const recordedAt = clock().toISOString();
          const taskVersion = current.taskVersion + 1;
          const { line, checksum } = buildRevision(taskId, taskVersion, input.changeKind, input.actor, draft, recordedAt);

          await insertRevision(trx as unknown as Kysely<DB>, line);
          hooks?.afterAppend?.({ taskId, taskVersion });
          await replaceCurrentRows(trx as unknown as Kysely<DB>, taskId, draft);
          await trx
            .updateTable("task_aggregates")
            .set({
              task_version: taskVersion,
              updated_at: recordedAt,
              tip_revision_id: line.revisionId,
              tip_task_version: taskVersion,
              tip_recorded_at: recordedAt,
              tip_change_kind: input.changeKind,
              tip_checksum: checksum,
            })
            .where("task_id", "=", taskId)
            .execute();
          hooks?.afterPublish?.({ taskId, taskVersion });

          return aggregateFromParts(
            {
              task_id: taskId,
              format_version: current.formatVersion,
              task_version: taskVersion,
              updated_at: recordedAt,
              tip_task_version: taskVersion,
              tip_recorded_at: recordedAt,
              tip_change_kind: input.changeKind,
              tip_checksum: checksum,
            },
            draft.task,
            draft.subtasks,
            draft.assignments,
          );
        });
      });
    },

    async readRevisions(taskId, visitor): Promise<void> {
      assertTaskId(taskId);
      const context = await getStoreContext(dataDir);
      const rows = await context.db
        .selectFrom("task_revisions")
        .selectAll()
        .where("aggregate_id", "=", taskId)
        .orderBy("task_version")
        .execute();
      if (rows.length === 0) throw new EntryNotFoundError(`任务聚合不存在：${taskId}`);
      for (const row of rows) {
        const line: RevisionLine = {
          formatVersion: row.format_version,
          revisionId: row.revision_id,
          taskId: row.aggregate_id,
          taskVersion: row.task_version,
          recordedAt: row.recorded_at,
          changeKind: row.change_kind as ChangeKind,
          actor: {
            kind: row.actor_kind as RevisionActor["kind"],
            memberId: row.actor_member_id,
            name: row.actor_name,
          },
          checksum: row.checksum,
          snapshot: JSON.parse(row.snapshot_json) as RevisionLine["snapshot"],
        };
        const { checksum, ...rest } = line;
        if (checksumOf(rest) !== checksum) {
          throw new StorageCorruptionError(`revision checksum 不匹配：${taskId} v${row.task_version}`);
        }
        await visitor(line);
      }
    },

    async listTaskIds(): Promise<string[]> {
      const context = await getStoreContext(dataDir);
      const rows = await context.db
        .selectFrom("task_aggregates")
        .select("task_id")
        .orderBy("task_id")
        .execute();
      return rows.map((row) => row.task_id);
    },

    drain(): Promise<void> {
      return queue.drain();
    },

    async pauseWrites(): Promise<() => void> {
      const resume = queue.pause();
      await queue.drain();
      return resume;
    },
  };
}

/**
 * 直接读取一个聚合的当前状态；不存在返回 null。
 * @param dataDir 数据目录。
 * @param taskId 主任务 UUID。
 * @returns TaskAggregate。
 */
export async function readTaskAggregate(dataDir: string, taskId: string): Promise<TaskAggregate | null> {
  assertTaskId(taskId);
  const context = await getStoreContext(dataDir);
  return await readAggregate(context.db, taskId);
}

/**
 * 读取全部主任务聚合（share/dashboard/history 的统一入口）。
 * 单个聚合损坏时跳过，避免成员视图整体 500。
 * @param dataDir 数据目录。
 * @returns 任务聚合列表。
 */
export async function readAllTaskAggregates(dataDir: string): Promise<TaskAggregate[]> {
  const context = await getStoreContext(dataDir);
  const ids = await context.db.selectFrom("task_aggregates").select("task_id").orderBy("task_id").execute();
  const aggregates: TaskAggregate[] = [];
  for (const row of ids) {
    try {
      const aggregate = await readAggregate(context.db, row.task_id);
      if (aggregate) aggregates.push(aggregate);
    } catch {
      // 单个损坏聚合按不可见处理（05 §7 不泄露存储细节）。
    }
  }
  return aggregates;
}
