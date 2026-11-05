import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { sql } from "kysely";
import { checksumOf } from "../../storage/checksum.js";
import { openDiagnosticDb } from "../../storage/db.js";
import type { Manifest } from "../../storage/manifest-store.js";
import { SUPPORTED_FORMAT_VERSION } from "../../storage/manifest-store.js";
import { SCHEMA_VERSION } from "../../storage/migrations.js";
import { TEMP_PREFIX } from "../../storage/paths.js";

/**
 * 数据目录只读校验（06 §8.3/§10、07 §9）——备份、恢复与 doctor 共用的唯一口径。
 *
 * 本模块绝不写文件：JSONL 尾部半行只报告为 `fixable`，截断仍由启动恢复
 * （`recoverJsonlTail`）执行，doctor 因此可以在服务运行/离线时安全读取。
 */

/** 备份目录内的校验报告文件名；数据目录校验与复制都排除它（它不是数据文件）。 */
export const BACKUP_REPORT_FILE = "backup.json";

/** 在线备份复制时排除的顶层条目（06 §10：锁状态、临时目录与备份自身不参与快照）。 */
export const EXCLUDED_DATA_ENTRIES = ["locks", "tmp", "backups", ".ztask-lock"] as const;

/** 数据目录内的一个普通文件（校验与统计的最小单位）。 */
export interface DataDirFile {
  /** 相对数据目录的 POSIX 路径。 */
  path: string;
  /** 绝对路径。 */
  absolutePath: string;
  /** 字节数。 */
  size: number;
}

/** 问题种类：与 VALIDATION 报告/doctor 建议一一对应。 */
export type ValidationIssueKind =
  | "manifest"
  | "json"
  | "jsonl-tail"
  | "jsonl-checksum"
  | "jsonl-sequence"
  | "revision-tip"
  | "reference"
  | "network"
  | "shape"
  | "sqlite";

/** 一条校验问题。 */
export interface ValidationIssue {
  /** 相对数据目录的 POSIX 路径。 */
  path: string;
  kind: ValidationIssueKind;
  /** true 表示重启恢复可自愈（JSONL 尾部半行、current 落后 revision）；其余问题必须从备份恢复。 */
  fixable: boolean;
  /** 可读的诊断信息（不含敏感内容）。 */
  detail: string;
}

/** 校验结果；`files`/`stats` 供备份报告复用。 */
export interface ValidationResult {
  /** 无任何问题时为 true。 */
  ok: boolean;
  issues: ValidationIssue[];
  /** 参与校验的文件数与总字节数（已排除 locks/tmp/backups/backup.json）。 */
  stats: { fileCount: number; byteCount: number };
  files: DataDirFile[];
  manifest: Manifest | null;
}

const UUID_DIR_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CORRUPT_COPY_PATTERN = /\.corrupt-\d+$/;

/** 顶层不参与校验/复制的条目（锁、临时、备份自身与校验报告）。 */
const TOP_LEVEL_SKIPPED = new Set<string>([...EXCLUDED_DATA_ENTRIES, BACKUP_REPORT_FILE]);

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * 列出数据目录中参与快照的普通文件（相对 POSIX 路径 + 大小）。
 * 排除：顶层 locks/tmp/backups/.ztask-lock/backup.json、原子写临时文件、尾部恢复留下的
 * `<name>.corrupt-<stamp>` 副本、符号链接与非普通文件。只读取目录元数据，不写文件。
 * @param dataDir 数据目录根。
 * @returns 按相对路径升序的文件列表。
 */
export async function listDataDirFiles(dataDir: string): Promise<DataDirFile[]> {
  const root = path.resolve(dataDir);
  const files: DataDirFile[] = [];

  async function walk(dir: string, relative: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw cause;
    }
    entries.sort((a, b) => compareText(a.name, b.name));
    for (const entry of entries) {
      if (relative === "" && TOP_LEVEL_SKIPPED.has(entry.name)) continue;
      if (entry.name.startsWith(TEMP_PREFIX) || CORRUPT_COPY_PATTERN.test(entry.name)) continue;
      const relativePath = relative === "" ? entry.name : `${relative}/${entry.name}`;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      let size = 0;
      try {
        size = (await stat(absolutePath)).size;
      } catch {
        size = 0;
      }
      files.push({ path: relativePath, absolutePath, size });
    }
  }

  await walk(root, "");
  return files;
}

type JsonRead = { ok: true; value: unknown } | { ok: false; detail: string };

/** 读取并解析 JSON；缺失与损坏都以诊断信息返回，不抛错。 */
async function readJsonSafe(absolutePath: string): Promise<JsonRead> {
  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return { ok: false, detail: "文件不存在" };
    return { ok: false, detail: `文件不可读：${(cause as Error).message}` };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, detail: "JSON 无法解析（文件可能不完整）" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** manifest 结构问题；合法返回 null。 */
function manifestProblem(value: unknown): string | null {
  if (!isRecord(value)) return "manifest 不是 JSON 对象";
  const { formatVersion, applicationVersion, createdAt, timeZone } = value;
  if (typeof formatVersion !== "number" || !Number.isInteger(formatVersion) || formatVersion < 1) {
    return "manifest.formatVersion 非法";
  }
  if (formatVersion > SUPPORTED_FORMAT_VERSION) {
    return `manifest.formatVersion ${formatVersion} 高于应用支持的 ${SUPPORTED_FORMAT_VERSION}，请先升级应用`;
  }
  if (typeof applicationVersion !== "string") return "manifest.applicationVersion 非法";
  if (typeof createdAt !== "string") return "manifest.createdAt 非法";
  if (typeof timeZone !== "string" || timeZone.trim() === "") return "manifest.timeZone 非法";
  return null;
}

/** network.json 形状问题（06 §3.1）；合法返回 null。 */
function networkFileProblem(value: unknown): string | null {
  if (!isRecord(value)) return "network.json 不是 JSON 对象";
  if (typeof value.formatVersion !== "number") return "network.json formatVersion 非法";
  const listener = value.shareListener;
  if (!isRecord(listener)) return "network.json shareListener 缺失";
  if (typeof listener.enabled !== "boolean") return "network.json shareListener.enabled 非法";
  const nullableString = (field: unknown): boolean => field === null || typeof field === "string";
  if (!nullableString(listener.host)) return "network.json shareListener.host 非法";
  if (listener.port !== null && !(typeof listener.port === "number" && Number.isInteger(listener.port))) {
    return "network.json shareListener.port 非法";
  }
  if (!nullableString(listener.shareBaseUrl)) return "network.json shareListener.shareBaseUrl 非法";
  return null;
}

/** 文件夹实体问题；只校验校验/引用需要的字段。 */
function folderProblem(value: unknown, id: string): string | null {
  if (!isRecord(value)) return "文件夹不是 JSON 对象";
  if (value.id !== id) return `文件夹 id 与文件名不一致（文件 ${id}）`;
  if (value.parentId !== null && value.parentId !== undefined && typeof value.parentId !== "string") {
    return "文件夹 parentId 非法";
  }
  return null;
}

/** 成员实体问题；只校验校验/引用需要的字段。 */
function memberProblem(value: unknown, id: string): string | null {
  if (!isRecord(value)) return "成员不是 JSON 对象";
  if (value.id !== id) return `成员 id 与文件名不一致（文件 ${id}）`;
  if (value.archivedAt !== null && value.archivedAt !== undefined && typeof value.archivedAt !== "string") {
    return "成员 archivedAt 非法";
  }
  return null;
}

/** revisions.jsonl 单行结构问题；合法返回 null。 */
function revisionProblem(record: Record<string, unknown>, taskId: string): string | null {
  if (record.taskId !== taskId) return `revision taskId 与聚合不一致（${String(record.taskId)}）`;
  if (typeof record.taskVersion !== "number" || !Number.isInteger(record.taskVersion) || record.taskVersion < 1) {
    return "revision taskVersion 非法";
  }
  if (typeof record.recordedAt !== "string") return "revision recordedAt 非法";
  if (!isRecord(record.snapshot) || !isRecord((record.snapshot as Record<string, unknown>).task)) {
    return "revision snapshot 结构非法";
  }
  return null;
}

/** current.json 结构问题；合法返回 null。 */
function currentProblem(value: unknown, taskId: string): string | null {
  if (!isRecord(value)) return "current 不是 JSON 对象";
  if (value.taskId !== taskId) return `current.taskId 与目录名不一致（目录 ${taskId}）`;
  if (typeof value.taskVersion !== "number" || !Number.isInteger(value.taskVersion) || value.taskVersion < 1) {
    return "current.taskVersion 非法";
  }
  const tip = value.revisionTip;
  if (!isRecord(tip) || typeof tip.checksum !== "string" || typeof tip.taskVersion !== "number") {
    return "current.revisionTip 结构非法";
  }
  if (!isRecord(value.task)) return "current.task 结构非法";
  if (typeof value.task.folderId !== "string") return "current.task.folderId 非法";
  if (!Array.isArray(value.subtasks)) return "current.subtasks 非法";
  if (!Array.isArray(value.assignments)) return "current.assignments 非法";
  return null;
}

/** 单个聚合的校验上下文（current + revisions 的解析产物）。 */
interface AggregateState {
  taskId: string;
  current: Record<string, unknown> | null;
  currentPath: string;
  latestRevision: RevisionLineLike | null;
  revisionsHealthy: boolean;
}

/** revisions.jsonl 解析后的一行（只保留校验需要的字段）。 */
interface RevisionLineLike {
  taskVersion: number;
  checksum: string;
  taskId: string;
}

/**
 * 只读校验一个数据目录（06 §8.3/§10）。
 *
 * 检查项：manifest 结构、全部 JSON 可解析、revisions.jsonl 每行 checksum 与版本单调、
 * current.revisionTip 与最新 revision 一致、folder parent / task folderId / assignment
 * 成员与任务引用存在、network.json 形状。JSONL 末尾未完成写入标记为 `fixable`。
 * @param dataDir 数据目录根（可以是刚复制出来的备份临时目录）。
 * @returns 校验结果（含文件统计与 manifest）。
 */
async function validateLegacyDataDir(dataDir: string): Promise<ValidationResult> {
  const root = path.resolve(dataDir);
  const files = await listDataDirFiles(root);
  const byPath = new Map(files.map((file) => [file.path, file]));
  const issues: ValidationIssue[] = [];
  const stats = {
    fileCount: files.length,
    byteCount: files.reduce((sum, file) => sum + file.size, 0),
  };

  function addIssue(issuePath: string, kind: ValidationIssueKind, fixable: boolean, detail: string): void {
    issues.push({ path: issuePath, kind, fixable, detail });
  }

  // 1) manifest：结构 + 格式版本（比应用新则拒绝）。
  let manifest: Manifest | null = null;
  const manifestFile = byPath.get("manifest.json");
  if (manifestFile === undefined) {
    addIssue("manifest.json", "manifest", false, "缺少 manifest.json，数据目录不是完整备份");
  } else {
    const read = await readJsonSafe(manifestFile.absolutePath);
    if (!read.ok) {
      addIssue("manifest.json", "manifest", false, read.detail);
    } else {
      const problem = manifestProblem(read.value);
      if (problem !== null) addIssue("manifest.json", "manifest", false, problem);
      else manifest = read.value as Manifest;
    }
  }

  // 2) 全部 JSON 可解析（manifest 已单独处理；revisions.jsonl 走 3）。
  const parsed = new Map<string, unknown>();
  for (const file of files) {
    if (!file.path.endsWith(".json") || file.path === "manifest.json") continue;
    const read = await readJsonSafe(file.absolutePath);
    if (!read.ok) {
      addIssue(file.path, "json", false, read.detail);
      continue;
    }
    parsed.set(file.path, read.value);
  }

  // 3) network.json 形状（内容损坏已在上一步报告，这里只做形状）。
  if (parsed.has("network.json")) {
    const problem = networkFileProblem(parsed.get("network.json"));
    if (problem !== null) addIssue("network.json", "network", false, problem);
  }

  // 4) 任务夹与成员实体：收集引用目标，再校验 parent 引用。
  const folderIds = new Set<string>();
  const folderParents = new Map<string, string | null>();
  const memberIds = new Set<string>();
  for (const file of files) {
    const folderMatch = /^folders\/([^/]+)\.json$/.exec(file.path);
    if (folderMatch !== null) {
      const id = folderMatch[1]!;
      const value = parsed.get(file.path);
      if (value === undefined) continue; // 解析失败已报告
      const problem = folderProblem(value, id);
      if (problem !== null) {
        addIssue(file.path, "json", false, problem);
        continue;
      }
      const parentId = (value as { parentId?: unknown }).parentId;
      folderIds.add(id);
      folderParents.set(id, typeof parentId === "string" ? parentId : null);
      continue;
    }
    const memberMatch = /^members\/([^/]+)\.json$/.exec(file.path);
    if (memberMatch !== null) {
      const id = memberMatch[1]!;
      const value = parsed.get(file.path);
      if (value === undefined) continue;
      const problem = memberProblem(value, id);
      if (problem !== null) {
        addIssue(file.path, "json", false, problem);
        continue;
      }
      memberIds.add(id);
    }
  }
  for (const [id, parentId] of folderParents) {
    if (parentId !== null && !folderIds.has(parentId)) {
      addIssue(`folders/${id}.json`, "reference", false, `父任务夹 ${parentId} 不存在`);
    }
  }

  // 5) 每个任务聚合：current / revisions / tip / 引用。
  const taskIds = new Set<string>();
  for (const file of files) {
    const match = /^tasks\/([^/]+)\//.exec(file.path);
    if (match !== null && UUID_DIR_PATTERN.test(match[1]!)) taskIds.add(match[1]!);
  }

  for (const taskId of [...taskIds].sort(compareText)) {
    const state = await validateAggregate(taskId);
    validateReferences(state);
  }

  /**
   * 校验一个聚合的 current 与 revisions，并把结论写进 issues。
   * 返回给引用校验用的上下文。内部函数读取 state 而不是闭包变量。
   */
  async function validateAggregate(taskId: string): Promise<AggregateState> {
    const currentPath = `tasks/${taskId}/current.json`;
    const revisionsPath = `tasks/${taskId}/revisions.jsonl`;
    const state: AggregateState = {
      taskId,
      current: null,
      currentPath,
      latestRevision: null,
      revisionsHealthy: true,
    };

    const currentFile = byPath.get(currentPath);
    if (currentFile !== undefined) {
      const read = await readJsonSafe(currentFile.absolutePath);
      if (!read.ok) {
        addIssue(currentPath, "json", false, read.detail);
      } else {
        const problem = currentProblem(read.value, taskId);
        if (problem !== null) addIssue(currentPath, "json", false, problem);
        else state.current = read.value as Record<string, unknown>;
      }
    }

    const revisionsFile = byPath.get(revisionsPath);
    if (revisionsFile === undefined) {
      if (state.current !== null) {
        addIssue(currentPath, "revision-tip", false, "current 存在但 revisions.jsonl 缺失（历史缺失，需从备份恢复）");
      }
      return state;
    }

    let raw: string;
    try {
      raw = await readFile(revisionsFile.absolutePath, "utf8");
    } catch {
      addIssue(revisionsPath, "json", false, "revisions.jsonl 不可读");
      state.revisionsHealthy = false;
      return state;
    }

    const endsWithNewline = raw.endsWith("\n");
    const lines = raw.split("\n");
    if (endsWithNewline) lines.pop();
    // 末尾缺换行即"最后一行未完成写入"；它单独判定，不作为中间损坏。
    const incompleteTail = !endsWithNewline && raw.length > 0;
    const completeCount = incompleteTail ? lines.length - 1 : lines.length;
    let previousVersion = 0;

    for (let index = 0; index < completeCount; index += 1) {
      const line = lines[index] ?? "";
      if (line.trim() === "") continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        addIssue(revisionsPath, "jsonl-checksum", false, `第 ${index + 1} 行不是完整 JSON（中间损坏，需从备份恢复）`);
        state.revisionsHealthy = false;
        break;
      }
      const { checksum, ...rest } = record;
      if (typeof checksum !== "string" || checksum !== checksumOf(rest)) {
        addIssue(revisionsPath, "jsonl-checksum", false, `第 ${index + 1} 行 checksum 不匹配（中间损坏，需从备份恢复）`);
        state.revisionsHealthy = false;
        break;
      }
      const problem = revisionProblem(rest, taskId);
      if (problem !== null) {
        addIssue(revisionsPath, "json", false, `第 ${index + 1} 行 ${problem}`);
        state.revisionsHealthy = false;
        break;
      }
      const version = rest.taskVersion as number;
      if (previousVersion === 0 && version !== 1) {
        addIssue(revisionsPath, "jsonl-sequence", false, `首行 taskVersion 应为 1，实际为 ${version}`);
        state.revisionsHealthy = false;
        break;
      }
      if (previousVersion !== 0 && version !== previousVersion + 1) {
        addIssue(revisionsPath, "jsonl-sequence", false, `第 ${index + 1} 行 taskVersion ${version} 不连续（上一行 ${previousVersion}）`);
        state.revisionsHealthy = false;
        break;
      }
      previousVersion = version;
      state.latestRevision = { taskVersion: version, checksum, taskId };
    }

    if (incompleteTail) {
      // 前文全部有效才谈得上"仅尾部未完成"；否则中间损坏已报告，修复入口不是截断。
      if (state.revisionsHealthy) {
        addIssue(revisionsPath, "jsonl-tail", true, "最后一行未完成写入（缺换行或 JSON 不完整）；启动恢复会先备份原文件再截断到最后一个完整行");
      }
      // 尾部半行已足以解释 current/revision 的不一致，不再叠加 revision-tip 噪音。
      state.revisionsHealthy = false;
    }

    if (state.revisionsHealthy && state.current !== null) {
      const current = state.current;
      const currentVersion = current.taskVersion as number;
      const tip = current.revisionTip as Record<string, unknown>;
      const latest = state.latestRevision;
      if (latest === null) {
        addIssue(currentPath, "revision-tip", false, "current 存在但 revisions.jsonl 为空（历史缺失，需从备份恢复）");
      } else if (currentVersion > latest.taskVersion) {
        addIssue(currentPath, "revision-tip", false, `current.taskVersion ${currentVersion} 领先 revision ${latest.taskVersion}，拒绝自动修复`);
      } else if (currentVersion === latest.taskVersion) {
        if (tip.checksum !== latest.checksum) {
          addIssue(currentPath, "revision-tip", false, "revisionTip.checksum 与最新 revision 不一致，拒绝自动修复");
        }
      } else {
        addIssue(currentPath, "revision-tip", false, `current.taskVersion ${currentVersion} 落后 revision ${latest.taskVersion}（崩溃窗口；下次启动会由最新 revision 重建）`);
      }
    }

    return state;
  }

  /** 引用关系：任务夹存在、分配成员存在、分配目标属于该聚合。 */
  function validateReferences(state: AggregateState): void {
    const current = state.current;
    if (current === null) return;
    const task = current.task as Record<string, unknown>;
    const folderId = task.folderId as string;
    if (!folderIds.has(folderId)) {
      addIssue(state.currentPath, "reference", false, `任务所属任务夹 ${folderId} 不存在`);
    }

    if (!Array.isArray(current.subtasks)) {
      addIssue(state.currentPath, "shape", false, "subtasks 不是数组（文件结构损坏，需从备份恢复）");
      return;
    }
    const subtasks = current.subtasks as Array<Record<string, unknown>>;
    for (const subtask of subtasks) {
      if (subtask === null || typeof subtask !== "object") {
        addIssue(state.currentPath, "shape", false, "subtasks 含非对象元素（文件结构损坏，需从备份恢复）");
        continue;
      }
      const subFolderId = subtask.folderId;
      if (typeof subFolderId === "string" && !folderIds.has(subFolderId)) {
        addIssue(state.currentPath, "reference", false, `小任务 ${String(subtask.id)} 所属任务夹 ${subFolderId} 不存在`);
      }
    }

    const knownTaskIds = new Set<string>([state.taskId]);
    for (const subtask of subtasks) {
      if (typeof subtask.id === "string") knownTaskIds.add(subtask.id);
    }
    if (!Array.isArray(current.assignments)) {
      addIssue(state.currentPath, "shape", false, "assignments 不是数组（文件结构损坏，需从备份恢复）");
      return;
    }
    const assignments = current.assignments as Array<Record<string, unknown>>;
    for (const assignment of assignments) {
      if (assignment === null || typeof assignment !== "object") {
        addIssue(state.currentPath, "shape", false, "assignments 含非对象元素（文件结构损坏，需从备份恢复）");
        continue;
      }
      const memberId = assignment.memberId;
      if (typeof memberId !== "string" || !memberIds.has(memberId)) {
        addIssue(state.currentPath, "reference", false, `分配引用的成员 ${String(memberId)} 不存在`);
      }
      const assignedTaskId = assignment.taskId;
      if (typeof assignedTaskId !== "string" || !knownTaskIds.has(assignedTaskId)) {
        addIssue(state.currentPath, "reference", false, `分配引用的任务 ${String(assignedTaskId)} 不属于该聚合`);
      }
    }
  }

  // ok = 无阻塞问题：可自动修复的问题（JSONL 尾半行、current 落后）不阻止备份/恢复，
  // 但 issues 仍会完整上报给 doctor；真正干净由 issues.length === 0 判断。
  return { ok: !issues.some((issue) => !issue.fixable), issues, stats, files, manifest };
}


/**
 * SQLite 数据目录只读校验（06 §7.4/§8）。
 *
 * 不打开 store 上下文（避免 migration/导入写库），只用只读连接做
 * integrity_check、外键、schema 版本、meta 和业务引用断言。SQLite 可能创建/删除
 * `-shm` 临时文件，但数据库内容不被修改。
 * @param root 数据目录。
 * @returns 校验结果。
 */
async function validateSqliteDataDir(root: string): Promise<ValidationResult> {
  const dbPath = path.join(root, "ztask.db");
  const issues: ValidationIssue[] = [];
  const files: DataDirFile[] = [];
  for (const name of ["ztask.db", "ztask.db-wal", "ztask.db-shm"]) {
    const absolutePath = path.join(root, name);
    try {
      const info = await stat(absolutePath);
      files.push({ path: name, absolutePath, size: info.size });
    } catch {
      // 缺失的 sidecar 是正常状态。
    }
  }
  const stats = {
    fileCount: files.length,
    byteCount: files.reduce((sum, file) => sum + file.size, 0),
  };

  const { db, raw } = openDiagnosticDb(dbPath);
  let manifest: Manifest | null = null;
  const add = (kind: ValidationIssue["kind"], detail: string): void => {
    issues.push({ path: "ztask.db", kind, fixable: false, detail });
  };
  try {
    await sql`PRAGMA query_only = ON`.execute(db);

    const integrity = await sql<{ integrity_check: string }>`PRAGMA integrity_check`.execute(db);
    const badIntegrity = integrity.rows.filter((row) => row.integrity_check !== "ok");
    if (badIntegrity.length > 0) {
      add("sqlite", `integrity_check 未通过：${badIntegrity.map((row) => row.integrity_check).join("; ")}`);
    }

    const foreignKeys = await sql<Record<string, unknown>>`PRAGMA foreign_key_check`.execute(db);
    if (foreignKeys.rows.length > 0) {
      add("sqlite", `外键校验未通过：${JSON.stringify(foreignKeys.rows.slice(0, 3))}`);
    }

    const versionResult = await sql<{ user_version: number }>`PRAGMA user_version`.execute(db);
    const schemaVersion = Number(versionResult.rows[0]?.user_version ?? 0);
    if (schemaVersion > SCHEMA_VERSION) {
      add("sqlite", `schema 版本 ${schemaVersion} 高于应用支持的 ${SCHEMA_VERSION}`);
    }
    if (schemaVersion < 1) add("sqlite", "schema 版本缺失或为 0");

    let meta: Record<string, string> = {};
    try {
      const rows = await db.selectFrom("meta").selectAll().execute();
      meta = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    } catch {
      add("sqlite", "meta 表缺失或不可读");
    }
    for (const key of ["application_version", "created_at", "time_zone"]) {
      if (typeof meta[key] !== "string" || meta[key] === "") add("sqlite", `meta.${key} 缺失`);
    }
    if (meta.time_zone !== undefined) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: meta.time_zone }).format(new Date());
      } catch {
        add("sqlite", `meta.time_zone 非法：${meta.time_zone}`);
      }
    }
    if (schemaVersion >= 1) {
      manifest = {
        formatVersion: schemaVersion,
        applicationVersion: meta.application_version ?? "0.0.0",
        createdAt: meta.created_at ?? new Date(0).toISOString(),
        timeZone: meta.time_zone ?? "UTC",
      };
    }

    const revisions = await sql<{ aggregate_id: string; min: number; max: number; count: number }>`
      SELECT aggregate_id, MIN(task_version) AS min, MAX(task_version) AS max, COUNT(*) AS count
      FROM task_revisions GROUP BY aggregate_id`.execute(db);
    for (const row of revisions.rows) {
      if (Number(row.min) !== 1 || Number(row.max) !== Number(row.count)) {
        add("sqlite", `聚合 ${row.aggregate_id} 的 revision 版本不连续`);
      }
    }

    const tips = await sql<{ task_id: string }>`
      SELECT a.task_id FROM task_aggregates a
      LEFT JOIN task_revisions r ON r.revision_id = a.tip_revision_id
      WHERE r.revision_id IS NULL
         OR r.task_version <> a.task_version
         OR r.checksum <> a.tip_checksum
         OR r.aggregate_id <> a.task_id`.execute(db);
    for (const row of tips.rows) add("sqlite", `聚合 ${row.task_id} 的 revision tip 不一致`);

    const missingMain = await sql<{ task_id: string }>`
      SELECT a.task_id FROM task_aggregates a
      LEFT JOIN tasks t ON t.id = a.task_id AND t.parent_id IS NULL
      WHERE t.id IS NULL`.execute(db);
    for (const row of missingMain.rows) add("sqlite", `聚合 ${row.task_id} 缺少主任务行`);

    const badAssignments = await sql<{ task_id: string }>`
      SELECT x.task_id FROM assignments x
      LEFT JOIN tasks t ON t.id = x.task_id
      WHERE t.id IS NULL OR t.aggregate_id <> x.aggregate_id`.execute(db);
    for (const row of badAssignments.rows) add("sqlite", `分配引用的任务 ${row.task_id} 不属于该聚合`);

    const badFolders = await sql<{ id: string }>`
      SELECT f.id FROM folders f
      LEFT JOIN folders p ON p.id = f.parent_id
      WHERE f.parent_id IS NOT NULL AND p.id IS NULL`.execute(db);
    for (const row of badFolders.rows) add("sqlite", `任务夹 ${row.id} 的父任务夹不存在`);
  } catch (cause) {
    add("sqlite", `数据库无法完成校验：${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    await db.destroy().catch(() => undefined);
    try {
      raw.close();
    } catch {
      // Kysely 的 destroy 可能已经关闭原生连接。
    }
  }

  return {
    ok: !issues.some((issue) => !issue.fixable),
    issues,
    stats,
    files,
    manifest,
  };
}

/**
 * 数据目录校验：有 ztask.db 时走 SQLite 只读校验；旧纯文件目录继续走 JSON/JSONL 校验，
 * 以保持旧备份可恢复。备份/恢复/doctor 共用此入口。
 * @param dataDir 数据目录根。
 * @returns 校验结果。
 */
export async function validateDataDir(dataDir: string): Promise<ValidationResult> {
  const root = path.resolve(dataDir);
  if (existsSync(path.join(root, "ztask.db"))) return await validateSqliteDataDir(root);
  return await validateLegacyDataDir(dataDir);
}
