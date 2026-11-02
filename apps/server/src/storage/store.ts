import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ensureDataDirLayout } from "./paths.js";
import { initManifest, type Manifest } from "./manifest-store.js";
import { iterateJsonl, recoverJsonlTail } from "./jsonl.js";
import { writeJsonAtomic } from "./atomic-json.js";
import { StorageCorruptionError } from "./errors.js";
import {
  createTaskStore,
  readTaskAggregate,
  taskCurrentPath,
  taskRevisionsPath,
  type TaskStore,
  type TaskStoreHooks,
} from "./task-store.js";
import type { RevisionLine, TaskAggregate } from "./task-types.js";
import { createEntityStore, type EntityStore } from "./entity-store.js";
import { buildIndexes, type DerivedIndexes } from "./indexes.js";

/** initStore 的装配项。 */
export interface StoreInitOptions {
  dataDir: string;
  /** 写入/校验 manifest 用的应用语义化版本。 */
  applicationVersion: string;
  /** 团队统一时区；仅 manifest 首建时落盘。 */
  timeZone?: string;
  clock?: () => Date;
  hooks?: TaskStoreHooks;
}

/** folders 实体的存储形状（06 §4.2）。 */
export interface FolderFile {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
}

/** members 实体的存储形状（06 §4.1；索引只消费 archivedAt）。 */
export interface MemberFile {
  id: string;
  name: string;
  role: string;
  color: string;
  archivedAt: string | null;
}

/** 存储门面：manifest、任务聚合存储、派生索引与队列排空。 */
export interface ZtaskStore {
  manifest: Manifest;
  tasks: TaskStore;
  /** 启动时建立的派生索引快照；提交后如需新鲜索引可调 rebuildIndexes。 */
  indexes: DerivedIndexes;
  folders: EntityStore<FolderFile>;
  members: EntityStore<MemberFile>;
  /** 从磁盘现状重建全部派生索引（06 §9）。 */
  rebuildIndexes(): Promise<DerivedIndexes>;
  /** 排空写队列（优雅关闭顺序：停连接 → 排空队列 → 释放锁，04 §9）。 */
  drain(): Promise<void>;
  /**
   * 在线备份的一致性边界（06 §10 / 07 §9）：委托任务写队列先暂停再排空，
   * 返回恢复函数。暂停期间成员/管理端写请求排队等待，不写入文件。
   * @returns resume；幂等。
   */
  pauseWrites(): Promise<() => void>;
}

/** 读取 revisions.jsonl 的最后一行（含 checksum 校验）；文件缺失或为空返回 null。 */
async function lastRevisionLine(filePath: string): Promise<RevisionLine | null> {
  let last: RevisionLine | null = null;
  try {
    await iterateJsonl(filePath, (line) => {
      last = line as unknown as RevisionLine;
    });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw cause;
  }
  return last;
}

/**
 * 从最新 revision 重建 current（06 §8.2：append 后、current 前崩溃的场景）；
 * revision 是历史与恢复依据，重建后 tip 与行内 checksum 严格一致。
 */
async function rebuildCurrentFromRevision(dataDir: string, taskId: string, last: RevisionLine): Promise<void> {
  const aggregate: TaskAggregate = {
    formatVersion: 1,
    taskId,
    taskVersion: last.taskVersion,
    updatedAt: last.recordedAt,
    revisionTip: {
      taskVersion: last.taskVersion,
      recordedAt: last.recordedAt,
      changeKind: last.changeKind,
      checksum: last.checksum,
    },
    task: last.snapshot.task,
    subtasks: last.snapshot.subtasks,
    assignments: last.snapshot.assignments,
  };
  await writeJsonAtomic(taskCurrentPath(dataDir, taskId), aggregate);
}

/**
 * 启动装配（07 §1 第 3–4 步的存储部分）：目录布局 → manifest 校验 →
 * 每个聚合做尾部恢复 + current/revisionTip 快路径校验 → 建立派生索引。
 * current 落后 revision 时自动重建；current 领先、tip 不匹配或 JSONL 中间损坏时拒绝启动（06 §8.3）。
 * @param options 装配项（dataDir 与 applicationVersion 必填）。
 * @returns ZtaskStore。
 * @throws StorageCorruptionError current 比 revision 新、tip checksum 不匹配或 JSONL 中间损坏。
 * @throws UnsupportedFormatError manifest 格式版本比应用新。
 */
export async function initStore(options: StoreInitOptions): Promise<ZtaskStore> {
  const { dataDir, applicationVersion } = options;
  await ensureDataDirLayout(dataDir);
  const manifest = await initManifest(dataDir, { applicationVersion, timeZone: options.timeZone });

  let taskDirNames: string[] = [];
  try {
    taskDirNames = await readdir(join(dataDir, "tasks"));
  } catch {
    taskDirNames = [];
  }
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  for (const taskId of taskDirNames.filter((name) => uuidLike.test(name))) {
    const revisionsPath = taskRevisionsPath(dataDir, taskId);
    await recoverJsonlTail(revisionsPath);
    const last = await lastRevisionLine(revisionsPath);
    let current: TaskAggregate | null = null;
    try {
      current = await readTaskAggregate(dataDir, taskId);
    } catch {
      // current 损坏不算绝路：revision 是恢复依据；仅当 revision 也缺失时才无解。
      current = null;
    }

    if (!last) {
      if (current) {
        throw new StorageCorruptionError(`current 存在但 revisions 为空（历史缺失）：${taskId}`);
      }
      continue;
    }
    if (current) {
      if (current.taskVersion > last.taskVersion) {
        throw new StorageCorruptionError(
          `current.taskVersion ${current.taskVersion} 领先 revision ${last.taskVersion}，拒绝自动修复：${taskId}`,
        );
      }
      if (current.taskVersion === last.taskVersion) {
        if (current.revisionTip.checksum !== last.checksum || current.revisionTip.taskVersion !== last.taskVersion) {
          throw new StorageCorruptionError(`revisionTip 与最新 revision 不一致，拒绝自动修复：${taskId}`);
        }
        continue; // 快路径：current 与尾部一致，健康。
      }
    }
    await rebuildCurrentFromRevision(dataDir, taskId, last);
  }

  const tasks = createTaskStore({ dataDir, clock: options.clock, hooks: options.hooks });
  const folders = createEntityStore<FolderFile>({ dataDir, subdir: "folders" });
  const members = createEntityStore<MemberFile>({ dataDir, subdir: "members" });

  const store: ZtaskStore = {
    manifest,
    tasks,
    folders,
    members,
    indexes: {} as DerivedIndexes,
    async rebuildIndexes(): Promise<DerivedIndexes> {
      const aggregates: TaskAggregate[] = [];
      for (const taskId of await tasks.listTaskIds()) {
        const aggregate = await readTaskAggregate(dataDir, taskId);
        if (aggregate) aggregates.push(aggregate);
      }
      const folderEntities = await folders.list();
      const memberEntities = await members.list();
      const archived = new Set(memberEntities.filter((m) => m.value.archivedAt !== null).map((m) => m.id));
      return buildIndexes({
        aggregates,
        folders: folderEntities.map((f) => ({ id: f.id, parentId: f.value.parentId })),
        archivedMemberIds: archived,
      });
    },
    drain(): Promise<void> {
      return tasks.drain();
    },
    pauseWrites(): Promise<() => void> {
      return tasks.pauseWrites();
    },
  };
  store.indexes = await store.rebuildIndexes();
  return store;
}
