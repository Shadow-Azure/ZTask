import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { initStore, type ZtaskStore } from "@ztask/server";

/**
 * 备份/恢复/doctor 测试夹具（#23）。
 *
 * 固定 UUID + 固定递增时钟，让"备份快照一致""恢复后索引等价""doctor 只读"这些
 * 断言可以逐字节比较；所有临时目录都在 /tmp 下，由调用方 afterEach 清理。
 */

export const FOLDER_ROOT_ID = "11111111-1111-4111-8111-111111111111";
export const FOLDER_CHILD_ID = "22222222-2222-4222-8222-222222222222";
export const MEMBER_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const MEMBER_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const TASK_ID = "33333333-3333-4333-8333-333333333333";
export const SUBTASK_ID = "44444444-4444-4444-8444-444444444444";

/** 团队时区（写入 manifest）。 */
export const TIME_ZONE = "Asia/Shanghai";

/** 测试应用版本。 */
export const APP_VERSION = "0.1.0";

/** 管理员 actor（revision 元数据）。 */
export function adminActor(): { kind: "admin"; memberId: null; name: string } {
  return { kind: "admin", memberId: null, name: "管理员" };
}

/** 每个用例独立的临时目录（真实存在）。 */
export async function makeTempDir(prefix = "ztask-recovery"): Promise<string> {
  const dir = path.join(tmpdir(), `${prefix}-${process.pid}-${Date.now()}-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * 递增假时钟：每次调用返回下一次分钟刻度，保证 recordedAt 唯一且可预测。
 * @param start 起始 UTC 时刻。
 * @returns 时钟。
 */
export function steppingClock(start = "2026-11-02T03:00:00.000Z"): () => Date {
  let current = Date.parse(start);
  return () => {
    const value = new Date(current);
    current += 60_000;
    return value;
  };
}

/**
 * 造一个健康数据目录：两个任务夹（父子）、两个成员、一个主任务 + 一个小任务，
 * 分配覆盖 owner/collaborator/小任务 owner（引用校验全部成立）。
 * @param dataDir 临时数据目录。
 * @param options 时钟与时区（缺省递增时钟 + Asia/Shanghai）。
 * @returns 已建立索引的存储门面。
 */
export async function seedDataDir(
  dataDir: string,
  options: { clock?: () => Date; timeZone?: string } = {},
): Promise<ZtaskStore> {
  const clock = options.clock ?? steppingClock();
  const store = await initStore({
    dataDir,
    applicationVersion: APP_VERSION,
    timeZone: options.timeZone ?? TIME_ZONE,
    clock,
  });

  await store.folders.put(FOLDER_ROOT_ID, { id: FOLDER_ROOT_ID, parentId: null, name: "产品", position: 0 });
  await store.folders.put(FOLDER_CHILD_ID, { id: FOLDER_CHILD_ID, parentId: FOLDER_ROOT_ID, name: "首页改版", position: 1 });
  await store.members.put(MEMBER_A_ID, { id: MEMBER_A_ID, name: "陈晨", role: "设计", color: "#2f6fe0", archivedAt: null });
  await store.members.put(MEMBER_B_ID, { id: MEMBER_B_ID, name: "林悦", role: "开发", color: "#1f9d6b", archivedAt: null });

  const createdAt = clock().toISOString();
  await store.tasks.createAggregate({
    taskId: TASK_ID,
    task: {
      folderId: FOLDER_CHILD_ID,
      parentId: null,
      description: "首页改版",
      progress: 20,
      detailText: "第一版详情",
      planText: "",
      importance: "high",
      dueDate: "2026-12-31",
      createdAt,
      deletedAt: null,
    },
    subtasks: [
      {
        id: SUBTASK_ID,
        parentId: TASK_ID,
        folderId: FOLDER_CHILD_ID,
        description: "整理视觉稿",
        progress: 0,
        importance: "mid",
        dueDate: null,
        createdAt,
        deletedAt: null,
      },
    ],
    assignments: [
      { taskId: TASK_ID, memberId: MEMBER_A_ID, kind: "owner" },
      { taskId: TASK_ID, memberId: MEMBER_B_ID, kind: "collaborator" },
      { taskId: SUBTASK_ID, memberId: MEMBER_B_ID, kind: "owner" },
    ],
    actor: adminActor(),
  });

  // seed 绕过 TaskStore 的索引更新：重建一次，保证调用方拿到的 indexes 与磁盘一致。
  store.indexes = await store.rebuildIndexes();
  return store;
}

/** 目录快照项：用于 doctor 只读断言（路径、大小、mtime 与内容摘要）。 */
export interface FileSnapshot {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

/**
 * 递归快照整个目录（含 locks/tmp 等所有文件），断言"没有写任何文件"。
 * @param root 目录根。
 * @returns 按路径排序的文件快照。
 */
export async function snapshotTree(root: string): Promise<FileSnapshot[]> {
  const out: FileSnapshot[] = [];

  async function walk(dir: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const raw = await readFile(absolutePath);
      const info = await stat(absolutePath);
      out.push({
        path: relativePath,
        size: info.size,
        mtimeMs: info.mtimeMs,
        sha256: createHash("sha256").update(raw).digest("hex"),
      });
    }
  }

  await walk(root, "");
  return out;
}

/** 简单延迟（并发窗口断言用）。 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 可手动触发的 Promise（测试并发窗口）。 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
}

/** 创建可手动完成的 Deferred。 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
