import { randomUUID } from "node:crypto";
import { ApiError, type FolderTreeNode } from "@ztask/shared";
import { createEntityStore, type EntityStore } from "../../storage/entity-store.js";
import type { TaskAggregate } from "../../storage/task-types.js";

/** folders/<id>.json 的持久化形态（06 §4.2）。 */
export interface FolderFile {
  formatVersion: number;
  id: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 文件夹服务装配项：数据目录与可注入时钟。 */
export interface FolderServiceDeps {
  dataDir: string;
  clock?: () => Date;
}

/** 文件夹服务：树、创建、重命名（05 §3.1–3.3；首版无移动/删除）。 */
export interface FolderService {
  create(input: { name: string; parentId: string | null }): Promise<FolderFile>;
  rename(id: string, name: string): Promise<FolderFile>;
  list(): Promise<FolderFile[]>;
  /**
   * 用新鲜聚合构建 FolderTreeNode[]（05 §3.1；counts 主任务口径）。
   * 返回 shared DTO 的精确类型，调用方（管理端与分享域）无需再做结构转换（§6.8）。
   */
  tree(aggregates: TaskAggregate[]): Promise<FolderTreeNode[]>;
}

/**
 * 创建文件夹服务；全部写操作走实体存储原子替换，读侧直读文件保证新鲜。
 * @param deps 数据目录与时钟。
 * @returns 服务与底层实体存储。
 */
export function createFolderService(deps: FolderServiceDeps): { service: FolderService; store: EntityStore<FolderFile> } {
  const store = createEntityStore<FolderFile>({ dataDir: deps.dataDir, subdir: "folders" });
  const clock = deps.clock ?? (() => new Date());

  function assertName(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) throw new ApiError(400, "INVALID_REQUEST", "任务夹名称不能为空");
    return trimmed;
  }

  async function assertParent(parentId: string | null): Promise<void> {
    if (parentId === null) return;
    if (!UUID_PATTERN.test(parentId)) {
      throw new ApiError(400, "INVALID_REQUEST", "parentId 非法（须为 UUID 或 null）");
    }
    if ((await store.get(parentId)) === null) {
      throw new ApiError(422, "INVALID_REQUEST", "父任务夹不存在");
    }
  }

  const service: FolderService = {
    async create(input): Promise<FolderFile> {
      const name = assertName(input.name);
      await assertParent(input.parentId);
      const siblings = (await store.list()).filter((f) => f.value.parentId === input.parentId);
      const now = clock().toISOString();
      const file: FolderFile = {
        formatVersion: 1,
        id: randomUUID(),
        parentId: input.parentId,
        name,
        position: siblings.length,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await store.put(file.id, file);
      return file;
    },

    async rename(id, name): Promise<FolderFile> {
      const trimmed = assertName(name);
      const existing = await store.get(id);
      if (!existing) throw new ApiError(404, "NOT_FOUND", "任务夹不存在");
      const updated: FolderFile = { ...existing, name: trimmed, updatedAt: clock().toISOString() };
      await store.put(id, updated);
      return updated;
    },

    async list(): Promise<FolderFile[]> {
      return (await store.list()).map((entry) => entry.value);
    },

    async tree(aggregates) {
      const folders = await service.list();
      const byParent = new Map<string | null, FolderFile[]>();
      for (const folder of folders) {
        const list = byParent.get(folder.parentId) ?? [];
        list.push(folder);
        byParent.set(folder.parentId, list);
      }

      const tasksByFolder = new Map<string, TaskAggregate[]>();
      for (const aggregate of aggregates) {
        if (aggregate.task.deletedAt !== null) continue;
        const list = tasksByFolder.get(aggregate.task.folderId) ?? [];
        list.push(aggregate);
        tasksByFolder.set(aggregate.task.folderId, list);
      }

      function buildNode(folder: FolderFile): FolderTreeNode {
        const children = (byParent.get(folder.id) ?? [])
          .sort((a, b) => a.position - b.position)
          .map(buildNode);
        const tasks = (tasksByFolder.get(folder.id) ?? []).map((aggregate) => ({
          id: aggregate.taskId,
          description: aggregate.task.description,
          progress: aggregate.task.progress,
          importance: aggregate.task.importance,
        }));
        const done = tasks.filter((task) => task.progress >= 100).length;
        return {
          id: folder.id,
          parentId: folder.parentId,
          name: folder.name,
          position: folder.position,
          children,
          tasks,
          counts: { done, todo: tasks.length - done },
        };
      }

      return (byParent.get(null) ?? [])
        .sort((a, b) => a.position - b.position)
        .map(buildNode);
    },
  };

  return { service, store };
}

/** 从持久化文件剔除内部字段的 Folder DTO。 */
/**
 * 从持久化文件剔除内部字段的 Folder DTO。
 * @param file 持久化文件内容。
 * @returns Folder DTO。
 */
export function toFolderDto(file: FolderFile): { id: string; parentId: string | null; name: string; position: number } {
  return { id: file.id, parentId: file.parentId, name: file.name, position: file.position };
}
