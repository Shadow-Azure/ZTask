import { stat } from "node:fs/promises";
import path from "node:path";
import {
  doctor,
  restoreFromBackup,
  RestoreError,
  type BackupReport,
  type BackupResult,
  type DoctorReport,
  type RestoreSummary,
} from "@ztask/server";

/**
 * `ztask backup / restore / doctor` 的实现（#23、07 §9）。
 *
 * 退出码语义（三个子命令一致，便于脚本与冒烟报告判定）：
 * - 0：成功；
 * - 1：操作失败（备份校验/网络不可达/进行中冲突、备份损坏、目标非空、doctor 发现问题）；
 * - 2：用法错误（参数非法、地址非法）。
 */

/** 成功。 */
export const EXIT_OK = 0;
/** 操作失败。 */
export const EXIT_FAILURE = 1;
/** 用法错误。 */
export const EXIT_USAGE = 2;

/** 在线备份的 CLI 参数。 */
export interface RunBackupOptions {
  /** 管理端基址，如 `http://127.0.0.1:8123`。 */
  url: string;
  /** 测试注入的 fetch；缺省使用全局 fetch。 */
  fetchImpl?: typeof fetch;
}

/** 离线恢复的 CLI 参数。 */
export interface RunRestoreOptions {
  backupDir: string;
  dataDir: string;
  /** 服务端应用版本（initStore 用于 manifest 首次创建）。 */
  applicationVersion: string;
}

/** doctor 的 CLI 参数。 */
export interface RunDoctorOptions {
  dataDir: string;
}

/** 统一错误体（05 §7）；仅用于 CLI 侧读取，不复制服务端实现。 */
interface ErrorBodyLike {
  error?: { code?: string; message?: string };
}

/**
 * 归一化管理端基址：只接受 http/https，去掉尾部斜杠。
 * @param raw 用户输入（`--url`）。
 * @returns 可拼路径的基址；非法时为 null。
 */
export function normalizeBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.hostname === "") return null;
  return trimmed.replace(/\/+$/, "");
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 打印备份报告的通用部分（API 与本地报告共用）。 */
function printBackupReport(report: BackupReport): void {
  console.log("  备份报告：");
  console.log(`    报告格式：${report.formatVersion}`);
  console.log(`    应用版本：${report.appVersion}`);
  console.log(`    创建时间：${report.createdAt}`);
  console.log(`    团队时区：${report.timeZone}`);
  console.log(`    数据目录：${report.dataDir}`);
  console.log(`    文件：${report.files} 个 / ${report.bytes} 字节`);
  console.log(`    排除：${report.excluded.join("、")}`);
  console.log(`    校验：${report.validation.ok ? "通过" : "未通过"}`);
}

/**
 * 通过管理端 HTTP 端点执行在线备份，并打印备份目录与报告。
 * @param options 管理端地址与可注入 fetch。
 * @returns 退出码（0 成功；1 网络/HTTP 失败）。
 */
export async function runBackup(options: RunBackupOptions): Promise<number> {
  const base = normalizeBaseUrl(options.url);
  if (base === null) {
    console.error(`管理端地址非法：${options.url}（示例：http://127.0.0.1:8123）`);
    return EXIT_USAGE;
  }
  const endpoint = `${base}/api/v1/admin/maintenance/backup`;
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, { method: "POST", headers: { accept: "application/json" } });
  } catch (cause) {
    console.error(`无法连接管理端 ${base}`);
    console.error("请确认 ztask serve 已在本机运行，并用 --url 指定实际的地址与端口。");
    console.error(`原因：${cause instanceof Error ? cause.message : String(cause)}`);
    return EXIT_FAILURE;
  }

  const body = await readJsonBody(response);
  if (response.status === 201 && isRecord(body) && typeof body.backupDir === "string" && isRecord(body.report)) {
    const result = body as unknown as BackupResult;
    console.log(`备份完成：${result.backupDir}`);
    printBackupReport(result.report);
    return EXIT_OK;
  }

  const errorBody = (isRecord(body) ? body : {}) as ErrorBodyLike;
  const code = errorBody.error?.code;
  const message = errorBody.error?.message ?? `HTTP ${response.status}`;
  if (code === "BACKUP_IN_PROGRESS") {
    console.error("备份未执行：已有备份正在进行，请稍后再试。");
    return EXIT_FAILURE;
  }
  if (code === "ADMIN_LOCAL_ONLY") {
    console.error("备份未执行：管理 API 仅允许从服务主机的本机调用，请在本机执行 ztask backup。");
    return EXIT_FAILURE;
  }
  console.error(`备份失败（HTTP ${response.status} ${code ?? ""}）：${message}`);
  return EXIT_FAILURE;
}

/**
 * 离线恢复备份到新数据目录，并打印摘要。
 * @param options 备份目录、目标数据目录与应用版本。
 * @returns 退出码（0 成功；1 备份损坏或目标不可用）。
 */
export async function runRestore(options: RunRestoreOptions): Promise<number> {
  try {
    const summary: RestoreSummary = await restoreFromBackup({
      backupDir: options.backupDir,
      targetDir: options.dataDir,
      applicationVersion: options.applicationVersion,
    });
    console.log(`恢复完成：${summary.backupDir} → ${summary.targetDir}`);
    if (summary.repaired) {
      console.log("  注意：备份含未完成的 JSONL 尾部，恢复时已由启动恢复备份原文件并截断。");
    }
    console.log(`  任务：${summary.tasks} 个主任务聚合`);
    console.log(`  任务夹：${summary.folders} 个；成员：${summary.members} 个`);
    console.log(`  文件：${summary.files} 个 / ${summary.bytes} 字节`);
    console.log(`  manifest：格式 ${summary.manifest.formatVersion}，应用 ${summary.manifest.applicationVersion}，时区 ${summary.manifest.timeZone}`);
    console.log(`  后续：停止旧服务后，用 ztask serve --data-dir ${summary.targetDir} 启动校验。`);
    return EXIT_OK;
  } catch (cause) {
    if (cause instanceof RestoreError) {
      console.error(`恢复失败：${cause.message}`);
      if (cause.code === "RESTORE_TARGET_NOT_EMPTY") {
        console.error("目标目录必须不存在或为空；请换一个新目录，或先人工确认旧数据可以移走。");
      }
      if (cause.code === "RESTORE_TARGET_INVALID") {
        console.error("目标路径必须是数据目录（不能与备份目录相同或互相包含）。");
      }
      if (cause.code === "RESTORE_BACKUP_INVALID") {
        for (const issue of cause.issues.slice(0, 10)) {
          console.error(`  - ${issue.path}：${issue.detail}`);
        }
        console.error("建议先运行 ztask doctor --data-dir <备份目录> 查看完整问题，再重新备份。");
      }
      return EXIT_FAILURE;
    }
    console.error(`恢复失败：${cause instanceof Error ? cause.message : String(cause)}`);
    return EXIT_FAILURE;
  }
}

/** 打印 doctor 报告。 */
function printDoctorReport(report: DoctorReport): void {
  console.log(`数据目录：${report.dataDir}`);
  console.log(`文件：${report.fileCount} 个 / ${report.byteCount} 字节`);
  if (report.manifest === null) {
    console.log("manifest：缺失或损坏");
  } else {
    console.log(
      `manifest：格式 ${report.manifest.formatVersion}，应用 ${report.manifest.applicationVersion}，时区 ${report.manifest.timeZone}（创建于 ${report.manifest.createdAt}）`,
    );
  }

  if (report.ok) {
    console.log("结论：健康，未发现问题。");
  } else {
    console.log(
      `结论：发现 ${report.issues.length} 个问题（可自动修复 ${report.autoFixable.length}，需备份介入 ${report.needsBackup.length}）。`,
    );
    if (report.autoFixable.length > 0) {
      console.log("【可自动修复】重启 ztask serve 时由启动恢复处理：");
      for (const issue of report.autoFixable) console.log(`  - ${issue.path}：${issue.detail}`);
    }
    if (report.needsBackup.length > 0) {
      console.log("【需备份介入】无法安全自动修复：");
      for (const issue of report.needsBackup) console.log(`  - ${issue.path}：${issue.detail}`);
    }
  }
  console.log("建议：");
  for (const suggestion of report.suggestions) console.log(`  - ${suggestion}`);
}

/**
 * 只读诊断数据目录；发现问题时以退出码 1 结束（便于脚本与冒烟报告判定）。
 * @param options 数据目录。
 * @returns 退出码（0 健康；1 有问题或目录不存在）。
 */
export async function runDoctor(options: RunDoctorOptions): Promise<number> {
  const dataDir = path.resolve(options.dataDir);
  let isDirectory = false;
  try {
    isDirectory = (await stat(dataDir)).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    console.error(`数据目录不存在或不是目录：${dataDir}`);
    return EXIT_FAILURE;
  }

  const report = await doctor({ dataDir });
  printDoctorReport(report);
  return report.ok ? EXIT_OK : EXIT_FAILURE;
}
