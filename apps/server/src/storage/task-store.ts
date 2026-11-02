import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChangeKind, RevisionActor } from "@ztask/shared";
import { appendJsonlLine, iterateJsonl } from "./jsonl.js";
import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import { EntryNotFoundError, StorageError, VersionConflictError } from "./errors.js";
import { TEMP_PREFIX } from "./paths.js";
import type { AssignmentRecord, RevisionLine, RevisionTip, SubtaskRecord, TaskAggregate, TaskRecord } from "./task-types.js";
import { createWriteQueue, type WriteQueue } from "./write-queue.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 校验 taskId 是服务端生成的 UUID——文件路径只接受 UUID，
 * 用户可见名称绝不参与路径，杜绝路径穿越（06 §10 / 07 §4）。
 */
function assertTaskId(taskId: string): void {
  if (!UUID_PATTERN.test(taskId)) {
    throw new StorageError("INVALID_TASK_ID", `taskId 非法（须为 UUID）：${taskId}`);
  }
}

/**
 * 聚合目录 `tasks/<taskId>/`；taskId 必须为 UUID。
 * @param dataDir 数据目录根。
 * @param taskId 主任务 UUID。
 * @returns 聚合目录绝对/相对路径。
 */
export function taskDir(dataDir: string, taskId: string): string {
  return join(dataDir, "tasks", taskId);
}

/**
 * 聚合 current.json 路径（最新状态缓存，可由 revision 重建）。
 * @param dataDir 数据目录根。
 * @param taskId 主任务 UUID。
 * @returns current.json 路径。
 */
export function taskCurrentPath(dataDir: string, taskId: string): string {
  return join(taskDir(dataDir, taskId), "current.json");
}

/**
 * 聚合 revisions.jsonl 路径（历史与恢复依据，只追加）。
 * @param dataDir 数据目录根。
 * @param taskId 主任务 UUID。
 * @returns revisions.jsonl 路径。
 */
export function taskRevisionsPath(dataDir: string, taskId: string): string {
  return join(taskDir(dataDir, taskId), "revisions.jsonl");
}

/**
 * 直接读取聚合 current；不存在返回 null，损坏向上抛（06 §5：current 是缓存，可由 revision 重建）。
 * @param dataDir 数据目录根。
 * @param taskId 主任务 UUID。
 * @returns 聚合内容；不存在时为 null。
 */
export async function readTaskAggregate(dataDir: string, taskId: string): Promise<TaskAggregate | null> {
  assertTaskId(taskId);
  try {
    return (await readJsonFile(taskCurrentPath(dataDir, taskId))) as TaskAggregate;
  } catch (cause) {
    if (cause instanceof Error && cause.name === "EntryNotFoundError") return null;
    throw cause;
  }
}

/** task-store 的故障注入缝：模拟 append 后 / publish 后崩溃（06 §8.2 的两个窗口）。 */
export interface TaskStoreHooks {
  /** revision append + fsync 完成后触发；抛错即模拟"append 后、current 前"崩溃。 */
  afterAppend?: (info: { taskId: string; taskVersion: number }) => void;
  /** current 原子发布完成后触发；抛错即模拟"current 后、索引前"失败。 */
  afterPublish?: (info: { taskId: string; taskVersion: number }) => void;
}

/** createTaskStore 的装配项：目录、时钟、注入缝与队列。 */
export interface TaskStoreOptions {
  dataDir: string;
  /** 可注入时钟（UTC）；缺省系统时间。 */
  clock?: () => Date;
  hooks?: TaskStoreHooks;
  /** 外部队列（测试/上层共享同一串行边界）；缺省内部新建。 */
  queue?: WriteQueue;
}

/** 创建聚合的输入：主任务体、初始小任务与分配（taskVersion 从 1 起）。 */
export interface CreateAggregateInput {
  taskId: string;
  task: TaskRecord;
  subtasks: SubtaskRecord[];
  assignments: AssignmentRecord[];
  actor: RevisionActor;
}

/** 提交变更的输入：期望版本、变更语义、操作者与队列内执行的 mutation。 */
export interface CommitInput {
  expectedVersion: number;
  changeKind: ChangeKind;
  actor: RevisionActor;
  /** 队列内、通过版本复查后调用；就地修改 draft，抛错则本次变更不落任何文件。 */
  mutate: (draft: { task: TaskRecord; subtasks: SubtaskRecord[]; assignments: AssignmentRecord[] }) => void;
}

/** 任务聚合存储门面：create/commit/readRevisions，全部写操作按 taskId 串行。 */
export interface TaskStore {
  createAggregate(input: CreateAggregateInput): Promise<TaskAggregate>;
  /** 队列内复查 expectedVersion → append revision → 原子发布 current（06 §8.2 顺序）。 */
  commit(taskId: string, input: CommitInput): Promise<TaskAggregate>;
  readRevisions(taskId: string, visitor: (line: RevisionLine) => void): Promise<void>;
  listTaskIds(): Promise<string[]>;
  drain(): Promise<void>;
  /**
   * 备份/维护用的一致性边界（06 §10）：先暂停新写入，再等待在途写入结束，返回恢复函数。
   * 暂停期间提交的写会排队，恢复后按提交顺序执行；未调用 resume 的暂停会让写入永久排队。
   * @returns resume；幂等，调用后队列恢复接受新写入。
   */
  pauseWrites(): Promise<() => void>;
}

/**
 * 创建任务聚合存储门面：create/commit/readRevisions/listTaskIds。
 * 全部写操作经 taskId 串行队列，append+fsync 是逻辑提交点，随后才原子发布 current（06 §8.2）。
 * @param options 装配项（dataDir 必填；clock/hooks/queue 可注入）。
 * @returns TaskStore。
 */
export function createTaskStore(options: TaskStoreOptions): TaskStore {
  const { dataDir, clock = () => new Date(), hooks, queue = createWriteQueue() } = options;

  async function buildRevision(taskId: string, taskVersion: number, changeKind: ChangeKind, actor: RevisionActor, snapshot: RevisionLine["snapshot"]): Promise<{ line: RevisionLine; checksum: string }> {
    const recordedAt = clock().toISOString();
    const line: Omit<RevisionLine, "checksum"> = {
      formatVersion: 1,
      revisionId: randomUUID(),
      taskId,
      taskVersion,
      recordedAt,
      changeKind,
      actor,
      snapshot,
    };
    const checksum = await appendJsonlLine(taskRevisionsPath(dataDir, taskId), line as Record<string, unknown>);
    return { line: { ...line, checksum }, checksum };
  }

  return {
    async createAggregate(input): Promise<TaskAggregate> {
      assertTaskId(input.taskId);
      return queue.run(input.taskId, async () => {
        const existing = await readTaskAggregate(dataDir, input.taskId);
        if (existing) {
          throw new StorageError("TASK_AGGREGATE_EXISTS", `任务聚合已存在：${input.taskId}`);
        }
        await mkdir(taskDir(dataDir, input.taskId), { recursive: true, mode: 0o700 });
        const snapshot = { task: input.task, subtasks: input.subtasks, assignments: input.assignments };
        const { line, checksum } = await buildRevision(input.taskId, 1, "create", input.actor, snapshot);
        hooks?.afterAppend?.({ taskId: input.taskId, taskVersion: 1 });
        const tip: RevisionTip = {
          taskVersion: 1,
          recordedAt: line.recordedAt,
          changeKind: "create",
          checksum,
        };
        const aggregate: TaskAggregate = {
          formatVersion: 1,
          taskId: input.taskId,
          taskVersion: 1,
          updatedAt: tip.recordedAt,
          revisionTip: tip,
          task: input.task,
          subtasks: input.subtasks,
          assignments: input.assignments,
        };
        await writeJsonAtomic(taskCurrentPath(dataDir, input.taskId), aggregate);
        hooks?.afterPublish?.({ taskId: input.taskId, taskVersion: 1 });
        return aggregate;
      });
    },

    async commit(taskId, input): Promise<TaskAggregate> {
      assertTaskId(taskId);
      return queue.run(taskId, async () => {
        const current = await readTaskAggregate(dataDir, taskId);
        if (!current) {
          throw new EntryNotFoundError(`任务聚合不存在：${taskId}`);
        }
        // 乐观版本复查必须在队列内做（04 §5.1），路由入口的检查只是预检。
        if (current.taskVersion !== input.expectedVersion) {
          throw new VersionConflictError(
            current.taskVersion,
            `版本冲突：期望 ${input.expectedVersion}，当前 ${current.taskVersion}`,
          );
        }
        const draft = structuredClone({ task: current.task, subtasks: current.subtasks, assignments: current.assignments });
        await input.mutate(draft);
        const taskVersion = current.taskVersion + 1;
        const { line, checksum } = await buildRevision(taskId, taskVersion, input.changeKind, input.actor, draft);
        hooks?.afterAppend?.({ taskId, taskVersion });
        const aggregate: TaskAggregate = {
          formatVersion: 1,
          taskId,
          taskVersion,
          updatedAt: line.recordedAt,
          revisionTip: { taskVersion, recordedAt: line.recordedAt, changeKind: input.changeKind, checksum },
          task: draft.task,
          subtasks: draft.subtasks,
          assignments: draft.assignments,
        };
        await writeJsonAtomic(taskCurrentPath(dataDir, taskId), aggregate);
        hooks?.afterPublish?.({ taskId, taskVersion });
        return aggregate;
      });
    },

    async readRevisions(taskId, visitor): Promise<void> {
      assertTaskId(taskId);
      try {
        await iterateJsonl(taskRevisionsPath(dataDir, taskId), (record) => {
          visitor(record as unknown as RevisionLine);
        });
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") {
          throw new EntryNotFoundError(`任务聚合不存在：${taskId}`);
        }
        throw cause;
      }
    },

    async listTaskIds(): Promise<string[]> {
      try {
        const entries = await readdir(join(dataDir, "tasks"));
        return entries.filter((entry) => UUID_PATTERN.test(entry));
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw cause;
      }
    },

    drain(): Promise<void> {
      return queue.drain();
    },

    async pauseWrites(): Promise<() => void> {
      // 顺序不可交换：先关闸门再 drain，才能保证「drain 观察到的在途集合」之后不会再有新写入。
      const resume = queue.pause();
      await queue.drain();
      return resume;
    },
  };
}

export { TEMP_PREFIX };
