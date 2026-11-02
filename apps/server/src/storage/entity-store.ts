import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { readJsonFile, writeJsonAtomic } from "./atomic-json.js";
import { StorageError } from "./errors.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 单实体 JSON 文件的统一存储接口：members/folders/share-links/auth-sessions
 * 都是 `<子目录>/<uuid>.json` 一文件一实体（06 §2–§5），写路径统一走原子替换。
 */

/** 实体存储门面；T 为实体文件内容。 */
export interface EntityStore<T> {
  /** 读取实体；不存在返回 null。 */
  get(id: string): Promise<T | null>;
  /** 原子写入实体（创建或整体替换）。 */
  put(id: string, value: T): Promise<void>;
  /** 列出全部实体（按文件名序）。 */
  list(): Promise<Array<{ id: string; value: T }>>;
}

/**
 * 创建某子目录的实体存储。ID 必须是服务端生成的 UUID——路径不接受用户输入，杜绝穿越（06 §10）。
 * @param options 装配项：数据目录与子目录名。
 * @param options.dataDir 数据目录根。
 * @param options.subdir 约定子目录名（members/folders/share-links/auth-sessions）。
 * @returns EntityStore 实例。
 */
export function createEntityStore<T>(options: { dataDir: string; subdir: string }): EntityStore<T> {
  const dir = join(options.dataDir, options.subdir);

  function assertId(id: string): void {
    if (!UUID_PATTERN.test(id)) {
      throw new StorageError("INVALID_ENTITY_ID", `实体 ID 非法（须为 UUID）：${id}`);
    }
  }

  return {
    async get(id: string): Promise<T | null> {
      assertId(id);
      try {
        return (await readJsonFile(join(dir, `${id}.json`))) as T;
      } catch (cause) {
        if (cause instanceof Error && cause.name === "EntryNotFoundError") return null;
        throw cause;
      }
    },

    async put(id: string, value: T): Promise<void> {
      assertId(id);
      // 子目录自足创建：实体存储不依赖启动布局先被调用。
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeJsonAtomic(join(dir, `${id}.json`), value);
    },

    async list(): Promise<Array<{ id: string; value: T }>> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw cause;
      }
      const out: Array<{ id: string; value: T }> = [];
      for (const name of names.sort()) {
        if (!name.endsWith(".json")) continue;
        const id = name.slice(0, -".json".length);
        out.push({ id, value: (await readJsonFile(join(dir, name))) as T });
      }
      return out;
    },
  };
}
