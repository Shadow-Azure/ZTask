import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "@ztask/shared";
import { writeJsonAtomic } from "../../storage/atomic-json.js";
import { TEMP_PREFIX } from "../../storage/paths.js";
import {
  BACKUP_REPORT_FILE,
  EXCLUDED_DATA_ENTRIES,
  validateDataDir,
  type ValidationIssue,
} from "./validate-service.js";

/**
 * 在线备份（06 §10、07 §9）：全局写队列动作。
 *
 * 流程：`pauseWrites()` → 等待在途写入 → 复制到 `<dataDir>/tmp/backup-*`（排除
 * locks/tmp/backups 自身）→ 只读校验 → 写 `backup.json` 报告 → `rename` 原子发布到
 * `<dataDir>/backups/<UTC 时间戳>-<uuid>/` → 恢复写入。任何一步失败都不留下半备份。
 */

/** `backup.json` 的报告格式版本（与数据格式版本解耦）。 */
export const BACKUP_REPORT_FORMAT_VERSION = 1;

/** 备份校验报告；同时落盘为备份目录内的 `backup.json`，并作为 API/CLI 响应。 */
export interface BackupReport {
  /** 报告格式版本。 */
  formatVersion: number;
  /** 发起备份的应用版本（CLI/服务端）。 */
  appVersion: string;
  /** UTC RFC 3339，同时决定备份目录名的时间戳前缀。 */
  createdAt: string;
  /** 备份时 manifest 的团队时区。 */
  timeZone: string;
  /** 备份源数据目录绝对路径（摘要，用于事后追溯）。 */
  dataDir: string;
  /** 参与快照的文件数（不含 backup.json 报告自身）。 */
  files: number;
  /** 参与快照的字节数。 */
  bytes: number;
  /** 快照排除的顶层条目（06 §10）。 */
  excluded: string[];
  /** 校验摘要；发布成功的备份恒为 ok。 */
  validation: { ok: boolean; issues: ValidationIssue[] };
}

/** 备份结果：发布后的目录与报告。 */
export interface BackupResult {
  backupDir: string;
  report: BackupReport;
}

/** 备份故障注入缝（测试模拟"发布前失败"与并发窗口）。 */
export interface BackupHooks {
  /** 临时目录已构建并通过校验、`rename` 原子发布之前调用；抛错即模拟发布前崩溃。 */
  beforePublish?: (context: { tmpDir: string; finalDir: string }) => void | Promise<void>;
}

/** 备份服务装配项。 */
export interface BackupServiceOptions {
  dataDir: string;
  appVersion: string;
  /** manifest 时区；由 bootstrap/路由装配时传入 manifest 值。 */
  timeZone: string;
  clock?: () => Date;
  /** 一致性边界：暂停新写入并等待在途写入，返回恢复函数（TaskStore/ZtaskStore.pauseWrites）。 */
  pauseWrites: () => Promise<() => void>;
  hooks?: BackupHooks;
}

/** 备份服务：同一实例内串行，进行中再次请求返回 409 BACKUP_IN_PROGRESS。 */
export interface BackupService {
  /** 执行一次在线备份；校验失败或发布失败时抛错且不留半备份。 */
  create(): Promise<BackupResult>;
  /** 是否有备份正在进行（观测/测试用）。 */
  isRunning(): boolean;
}

/** 复制过滤：排除锁、临时目录、备份自身与校验报告，以及原子写/尾部恢复的中间文件。 */
function makeCopyFilter(root: string): (source: string) => boolean {
  const excluded = new Set<string>([
    ...EXCLUDED_DATA_ENTRIES.map((name) => path.join(root, name)),
    path.join(root, BACKUP_REPORT_FILE),
  ]);
  return (source: string): boolean => {
    const resolved = path.resolve(source);
    if (excluded.has(resolved)) return false;
    const name = path.basename(resolved);
    return !name.startsWith(TEMP_PREFIX) && !/\.corrupt-\d+$/.test(name);
  };
}

/**
 * 逐个顶层条目复制数据目录到临时目录。
 *
 * 不能直接 `cp(dataDir, tmpDir)`：临时目录按 06 §10 位于 `<dataDir>/tmp/` 之内，
 * Node 的 `fs.cp` 会在过滤之前拒绝"复制到自身子目录"（ERR_FS_CP_EINVAL）。
 * 逐条目复制既保持临时目录位置，也让排除规则自然地少遍历一次 tmp/。
 * @param dataDir 源数据目录。
 * @param tmpDir 目标临时目录（会被创建）。
 */
async function copySnapshot(dataDir: string, tmpDir: string): Promise<void> {
  await mkdir(tmpDir, { recursive: true, mode: 0o700 });
  const filter = makeCopyFilter(dataDir);
  const entries = await readdir(dataDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(dataDir, entry.name);
    if (!filter(source)) continue;
    await cp(source, path.join(tmpDir, entry.name), { recursive: true, filter });
  }
}

/**
 * 创建在线备份服务。
 *
 * 单实例内 `running` 标记保证同一进程不会并发复制同一数据目录；跨进程由数据目录
 * 单写者锁保证。备份进行中再次调用抛 409（路由映射为 `BACKUP_IN_PROGRESS`）。
 * @param options 装配项（dataDir、appVersion、timeZone、pauseWrites 与故障注入缝）。
 * @returns BackupService。
 */
export function createBackupService(options: BackupServiceOptions): BackupService {
  const clock = options.clock ?? (() => new Date());
  const dataDir = path.resolve(options.dataDir);
  let running = false;

  async function copyAndPublish(createdAt: string): Promise<BackupResult> {
    const backupsDir = path.join(dataDir, "backups");
    const tmpRoot = path.join(dataDir, "tmp");
    await mkdir(backupsDir, { recursive: true, mode: 0o700 });
    await mkdir(tmpRoot, { recursive: true, mode: 0o700 });

    const stamp = createdAt.replace(/[:.]/g, "-");
    const finalDir = path.join(backupsDir, `${stamp}-${randomUUID()}`);
    // 临时目录必须与目标同盘（同在 dataDir 下），rename 才是原子发布。
    const tmpDir = path.join(tmpRoot, `backup-${randomUUID()}`);
    let published = false;
    try {
      await copySnapshot(dataDir, tmpDir);
      // 校验复制出来的快照而不是原目录：报告描述的是"备份里有什么"（07 §9）。
      const validation = await validateDataDir(tmpDir);
      if (!validation.ok) {
        const summary = validation.issues
          .slice(0, 5)
          .map((issue) => `${issue.path}：${issue.detail}`)
          .join("；");
        throw new ApiError(
          500,
          "INTERNAL_ERROR",
          `数据目录校验未通过，已放弃本次备份：${summary}`,
          { issues: validation.issues },
        );
      }
      const report: BackupReport = {
        formatVersion: BACKUP_REPORT_FORMAT_VERSION,
        appVersion: options.appVersion,
        createdAt,
        timeZone: options.timeZone,
        dataDir,
        files: validation.stats.fileCount,
        bytes: validation.stats.byteCount,
        excluded: [...EXCLUDED_DATA_ENTRIES],
        validation: { ok: true, issues: [] },
      };
      await writeJsonAtomic(path.join(tmpDir, BACKUP_REPORT_FILE), report);
      await options.hooks?.beforePublish?.({ tmpDir, finalDir });
      await rename(tmpDir, finalDir);
      published = true;
      return { backupDir: finalDir, report };
    } finally {
      if (!published) await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return {
    isRunning(): boolean {
      return running;
    },
    async create(): Promise<BackupResult> {
      if (running) {
        throw new ApiError(409, "BACKUP_IN_PROGRESS", "已有备份正在进行，请稍后再试");
      }
      running = true;
      try {
        const createdAt = clock().toISOString();
        const resume = await options.pauseWrites();
        try {
          return await copyAndPublish(createdAt);
        } finally {
          // 无论复制/校验/发布成败都必须恢复写入，否则服务会永久拒绝写请求。
          resume();
        }
      } finally {
        running = false;
      }
    },
  };
}
