import { join } from "node:path";
import { closeStoreContext, getStoreContext } from "./db.js";
import { createEntityStore, type EntityStore } from "./entity-store.js";
import { buildIndexes, type DerivedIndexes } from "./indexes.js";
import type { Manifest } from "./manifest-store.js";
import { createTaskStore, readTaskAggregate, type TaskStore, type TaskStoreHooks } from "./task-store.js";
import type { TaskAggregate } from "./task-types.js";

/** initStore 的装配项。 */
export interface StoreInitOptions {
  dataDir: string;
  /** 写入 meta 的应用语义化版本。 */
  applicationVersion: string;
  /** 团队统一时区；仅首次建库/旧文件导入时落盘。 */
  timeZone?: string;
  clock?: () => Date;
  hooks?: TaskStoreHooks;
}

/** folders 实体的最小形状，仅供派生索引使用。 */
export interface FolderFile {
  id: string;
  parentId: string | null;
  name: string;
  position: number;
}

/** members 实体的最小形状，仅供派生索引与归档判断使用。 */
export interface MemberFile {
  id: string;
  name: string;
  role: string;
  color: string;
  /** 管理员权限；缺省视为 false。 */
  isAdmin: boolean;
  archivedAt: string | null;
}

/** 存储门面：manifest、任务聚合、实体存储、派生索引与队列排空。 */
export interface ZtaskStore {
  manifest: Manifest;
  tasks: TaskStore;
  /** 启动时建立的派生索引快照；提交后如需新鲜索引可调 rebuildIndexes。 */
  indexes: DerivedIndexes;
  folders: EntityStore<FolderFile>;
  members: EntityStore<MemberFile>;
  /** 从数据库现状重建全部派生索引（06 §5）。 */
  rebuildIndexes(): Promise<DerivedIndexes>;
  /** 排空写队列（优雅关闭顺序：停连接 → 排空队列 → 释放锁，04 §9）。 */
  drain(): Promise<void>;
  /** 在线备份的一致性边界：暂停新写入并等待在途事务，返回恢复函数。 */
  pauseWrites(): Promise<() => void>;
  /** checkpoint 并关闭数据库连接；优雅关闭/测试清理时调用。 */
  close(): Promise<void>;
}

/**
 * 启动装配：打开/迁移/导入 SQLite → 装配存储门面 → 从数据库建立派生索引。
 * @param options 装配项（dataDir 与 applicationVersion 必填）。
 * @returns ZtaskStore。
 */
export async function initStore(options: StoreInitOptions): Promise<ZtaskStore> {
  const { dataDir, applicationVersion } = options;
  const context = await getStoreContext(dataDir, {
    applicationVersion,
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  });

  const tasks = createTaskStore({
    dataDir,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.hooks === undefined ? {} : { hooks: options.hooks }),
  });
  const folders = createEntityStore<FolderFile>({ dataDir, subdir: "folders" });
  const members = createEntityStore<MemberFile>({ dataDir, subdir: "members" });

  const store: ZtaskStore = {
    manifest: context.manifest,
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
      const archived = new Set(memberEntities.filter((member) => member.value.archivedAt !== null).map((member) => member.id));
      return buildIndexes({
        aggregates,
        folders: folderEntities.map((folder) => ({ id: folder.id, parentId: folder.value.parentId })),
        archivedMemberIds: archived,
      });
    },
    drain(): Promise<void> {
      return tasks.drain();
    },
    pauseWrites(): Promise<() => void> {
      return tasks.pauseWrites();
    },
    async close(): Promise<void> {
      await closeStoreContext(dataDir);
    },
  };
  store.indexes = await store.rebuildIndexes();
  return store;
}

/**
 * 数据目录下的 SQLite 文件路径；供测试/诊断引用。
 * @param dataDir 数据目录。
 * @returns ztask.db 路径。
 */
export function storeFile(dataDir: string): string {
  return join(dataDir, "ztask.db");
}
