import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Manifest } from "../../storage/manifest-store.js";
import { initStore } from "../../storage/store.js";
import { TEMP_PREFIX } from "../../storage/paths.js";
import {
  BACKUP_REPORT_FILE,
  EXCLUDED_DATA_ENTRIES,
  validateDataDir,
  type ValidationIssue,
} from "./validate-service.js";

/**
 * 离线恢复（06 §10、07 §9）：不直接在被恢复目录上边读边写。
 *
 * 流程：完整校验备份目录 → 复制到目标同级的临时目录 → 用 `initStore` 在临时目录
 * 执行一次真实启动装配（尾部恢复 + current 重建 + 派生索引）→ `rename` 原子切换。
 * 任何一步失败都不留下半恢复目录；目标目录必须不存在或为空。
 */

/** 恢复错误码；CLI 据此给出可操作提示（不影响 HTTP 契约，恢复只离线执行）。 */
export type RestoreErrorCode = "RESTORE_BACKUP_INVALID" | "RESTORE_TARGET_NOT_EMPTY" | "RESTORE_TARGET_INVALID";

/** 恢复失败：`issues` 携带不可自动修复的校验问题。 */
export class RestoreError extends Error {
  readonly code: RestoreErrorCode;
  readonly issues: ValidationIssue[];

  constructor(code: RestoreErrorCode, message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "RestoreError";
    this.code = code;
    this.issues = issues;
  }
}

/** 恢复摘要：CLI 打印用。 */
export interface RestoreSummary {
  /** 备份来源目录绝对路径。 */
  backupDir: string;
  /** 恢复后的数据目录绝对路径。 */
  targetDir: string;
  /** 复制的数据文件数（不含 backup.json 报告）。 */
  files: number;
  /** 复制的字节数。 */
  bytes: number;
  /** 主任务聚合数。 */
  tasks: number;
  /** 任务夹数。 */
  folders: number;
  /** 成员数。 */
  members: number;
  /** 恢复后生效的 manifest。 */
  manifest: Manifest;
  /** 备份中存在仅可自动修复的问题（JSONL 尾部半行），恢复过程中已由启动恢复处理。 */
  repaired: boolean;
}

/** restoreFromBackup 的输入。 */
export interface RestoreOptions {
  /** 备份目录（可为本机任意路径，通常位于原数据目录的 backups/ 下）。 */
  backupDir: string;
  /** 目标数据目录；必须不存在或为空。 */
  targetDir: string;
  /** 写入 manifest（仅首次创建时）与启动装配的应用版本。 */
  applicationVersion: string;
}

/** child 是否严格位于 parent 内部（用于拒绝目标/备份互相包含）。 */
function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** 恢复复制过滤：报告与中间文件不是数据；锁目录不随备份迁移。 */
function makeRestoreFilter(backupDir: string): (source: string) => boolean {
  const excluded = new Set<string>([
    ...EXCLUDED_DATA_ENTRIES.map((name) => path.join(backupDir, name)),
    path.join(backupDir, BACKUP_REPORT_FILE),
  ]);
  return (source: string): boolean => {
    const resolved = path.resolve(source);
    if (excluded.has(resolved)) return false;
    const name = path.basename(resolved);
    return !name.startsWith(TEMP_PREFIX) && !/\.corrupt-\d+$/.test(name);
  };
}

/**
 * 目标目录可用性：不存在返回 false；存在且为空返回 true；其余抛 RestoreError。
 * @param targetDir 目标数据目录绝对路径。
 * @returns 是否需要覆盖一个已存在的空目录。
 */
async function assertTargetUsable(targetDir: string): Promise<boolean> {
  let info;
  try {
    info = await stat(targetDir);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
  if (!info.isDirectory()) {
    throw new RestoreError("RESTORE_TARGET_INVALID", `目标路径已存在且不是目录：${targetDir}`);
  }
  const entries = await readdir(targetDir);
  if (entries.length > 0) {
    throw new RestoreError("RESTORE_TARGET_NOT_EMPTY", `目标目录非空，拒绝恢复：${targetDir}`);
  }
  return true;
}

/**
 * 从备份目录恢复出一个全新的数据目录（离线命令）。
 *
 * 备份中只允许「JSONL 尾部未完成写入」这类可自动修复的问题：它由 `initStore` 的
 * 启动恢复在同一临时目录内处理；其余问题（中间 checksum、current 不一致、引用缺失等）
 * 一律拒绝恢复，要求重新备份或人工取证。
 * @param options 备份目录、目标目录与应用版本。
 * @returns 恢复摘要。
 * @throws RestoreError 备份损坏 / 目标非空 / 目标非法；失败时不留下临时或半恢复目录。
 */
async function restoreLegacyBackup(options: RestoreOptions): Promise<RestoreSummary> {
  const backupDir = path.resolve(options.backupDir);
  const targetDir = path.resolve(options.targetDir);

  if (backupDir === targetDir || isInside(targetDir, backupDir) || isInside(backupDir, targetDir)) {
    throw new RestoreError("RESTORE_TARGET_INVALID", "目标目录与备份目录不能相同或互相包含");
  }

  // 1) 完整校验备份（只读，不写任何文件）。
  const validation = await validateDataDir(backupDir);
  if (validation.manifest === null) {
    throw new RestoreError(
      "RESTORE_BACKUP_INVALID",
      `备份缺少有效的 manifest.json：${backupDir}`,
      validation.issues,
    );
  }
  const blocking = validation.issues.filter((issue) => !issue.fixable);
  if (blocking.length > 0) {
    const first = blocking[0]!;
    throw new RestoreError(
      "RESTORE_BACKUP_INVALID",
      `备份校验未通过：${first.path}（${first.detail}）`,
      blocking,
    );
  }

  // 2) 目标必须不存在或为空。
  const targetExists = await assertTargetUsable(targetDir);

  // 3) 临时目录里复制 + 真实启动装配校验，成功后原子切换。
  const parent = path.dirname(targetDir);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  // 与目标同级，保证 rename 在同一文件系统内原子完成。
  const stageDir = path.join(parent, `.ztask-restore-${randomUUID()}`);
  let published = false;
  try {
    await cp(backupDir, stageDir, { recursive: true, filter: makeRestoreFilter(backupDir) });
    const store = await initStore({
      dataDir: stageDir,
      applicationVersion: options.applicationVersion,
      timeZone: validation.manifest.timeZone,
    });
    await store.drain();

    const summary: RestoreSummary = {
      backupDir,
      targetDir,
      files: validation.stats.fileCount,
      bytes: validation.stats.byteCount,
      tasks: (await store.tasks.listTaskIds()).length,
      folders: (await store.folders.list()).length,
      members: (await store.members.list()).length,
      manifest: store.manifest,
      repaired: validation.issues.length > 0,
    };

    // 目标存在但为空：POSIX rename 可直接替换空目录；先 rm 以兼容不支持该语义的平台。
    if (targetExists) await rm(targetDir, { recursive: true, force: true });
    await rename(stageDir, targetDir);
    published = true;
    return summary;
  } finally {
    if (!published) await rm(stageDir, { recursive: true, force: true });
  }
}


/**
 * 从 SQLite 备份恢复：复制单文件快照到同级 staging，真实启动一次（migration +
 * 一致性校验），关闭后原子切换。旧格式备份仍走 legacy 路径并由 importStore 导入。
 * @param options 备份目录、目标目录与应用版本。
 * @returns 恢复摘要。
 */
async function restoreSqliteBackup(options: RestoreOptions): Promise<RestoreSummary> {
  const backupDir = path.resolve(options.backupDir);
  const targetDir = path.resolve(options.targetDir);
  if (backupDir === targetDir || isInside(targetDir, backupDir) || isInside(backupDir, targetDir)) {
    throw new RestoreError("RESTORE_TARGET_INVALID", "目标目录与备份目录不能相同或互相包含");
  }

  const validation = await validateDataDir(backupDir);
  if (validation.manifest === null) {
    throw new RestoreError("RESTORE_BACKUP_INVALID", `备份缺少有效的 ztask.db：${backupDir}`, validation.issues);
  }
  const blocking = validation.issues.filter((issue) => !issue.fixable);
  if (blocking.length > 0) {
    const first = blocking[0]!;
    throw new RestoreError("RESTORE_BACKUP_INVALID", `备份校验未通过：${first.path}（${first.detail}）`, blocking);
  }

  const targetExists = await assertTargetUsable(targetDir);
  const parent = path.dirname(targetDir);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stageDir = path.join(parent, `.ztask-restore-${randomUUID()}`);
  let published = false;
  let summary: RestoreSummary | null = null;
  try {
    await mkdir(stageDir, { recursive: true, mode: 0o700 });
    await cp(path.join(backupDir, "ztask.db"), path.join(stageDir, "ztask.db"));
    const store = await initStore({
      dataDir: stageDir,
      applicationVersion: options.applicationVersion,
      timeZone: validation.manifest.timeZone,
    });
    const tasks = (await store.tasks.listTaskIds()).length;
    const folders = (await store.folders.list()).length;
    const members = (await store.members.list()).length;
    const manifest = store.manifest;
    await store.drain();
    await store.close();

    summary = {
      backupDir,
      targetDir,
      files: validation.stats.fileCount,
      bytes: validation.stats.byteCount,
      tasks,
      folders,
      members,
      manifest,
      repaired: false,
    };

    if (targetExists) await rm(targetDir, { recursive: true, force: true });
    await rename(stageDir, targetDir);
    published = true;
    return summary;
  } finally {
    if (!published) await rm(stageDir, { recursive: true, force: true });
  }
}

/**
 * 恢复入口：有 ztask.db 走 SQLite 快照恢复，否则按旧文件备份导入。
 * @param options 备份目录、目标目录与应用版本。
 * @returns 恢复摘要。
 */
export async function restoreFromBackup(options: RestoreOptions): Promise<RestoreSummary> {
  if (existsSync(path.join(path.resolve(options.backupDir), "ztask.db"))) {
    return await restoreSqliteBackup(options);
  }
  return await restoreLegacyBackup(options);
}
