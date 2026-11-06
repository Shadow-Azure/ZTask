import path from "node:path";
import type { Manifest } from "../../storage/manifest-store.js";
import { validateDataDir, type ValidationIssue } from "./validate-service.js";

/**
 * doctor：对现有数据目录做只读体检（06 §8.3、07 §9）。
 *
 * 分类口径：
 * - `autoFixable`：JSONL 尾部未完成写入——重启服务会先备份原文件再截断，不需要恢复备份；
 * - `needsBackup`：中间 checksum 损坏、current 与 revisionTip 不一致、引用缺失、manifest/JSON
 *   损坏、network.json 形状非法——无法安全自动修复，需要从最近一次在线备份恢复或人工取证。
 *
 * 本模块绝不写文件：所有判定只来自 `validateDataDir` 的只读扫描。
 */

/** doctor 报告（CLI 输出与测试断言共用）。 */
export interface DoctorReport {
  /** 被检查的数据目录绝对路径。 */
  dataDir: string;
  /** 没有任何问题时为 true。 */
  ok: boolean;
  /** 数据文件数与字节数。 */
  fileCount: number;
  byteCount: number;
  /** manifest 摘要；缺失/损坏时为 null。 */
  manifest: Pick<Manifest, "formatVersion" | "applicationVersion" | "createdAt" | "timeZone"> | null;
  /** 全部问题（原始口径）。 */
  issues: ValidationIssue[];
  /** 可自动修复的问题（重启时由启动恢复处理）。 */
  autoFixable: ValidationIssue[];
  /** 需要备份介入的问题。 */
  needsBackup: ValidationIssue[];
  /** 面向管理员的操作建议（中文，可直接展示）。 */
  suggestions: string[];
}

/**
 * 只读诊断一个数据目录。
 * @param options dataDir 数据目录根。
 * @returns doctor 报告；调用前后目录内容完全不变。
 */
export async function doctor(options: { dataDir: string }): Promise<DoctorReport> {
  const dataDir = path.resolve(options.dataDir);
  const validation = await validateDataDir(dataDir);
  const autoFixable = validation.issues.filter((issue) => issue.fixable);
  const needsBackup = validation.issues.filter((issue) => !issue.fixable);

  const suggestions: string[] = [];
  if (autoFixable.length > 0) {
    suggestions.push(
      "JSONL 尾部存在未完成写入：直接重启 ztask serve 即可自动备份原文件并截断到最后一条完整记录（06 §8.3）。",
    );
  }
  if (needsBackup.length > 0) {
    suggestions.push(
      "存在无法自动修复的问题：请用最近一次在线备份执行 ztask restore --backup <备份目录> --data-dir <新目录>，确认无误后再切换服务的数据目录。",
    );
    suggestions.push("在恢复前保留当前数据目录原样，便于事后取证；doctor 不会修改任何文件。");
  }
  if (validation.issues.length === 0) {
    suggestions.push("数据库完整性、外键、schema 版本、revision 序列与引用关系校验通过。");
  }

  return {
    dataDir,
    ok: validation.issues.length === 0,
    fileCount: validation.stats.fileCount,
    byteCount: validation.stats.byteCount,
    manifest:
      validation.manifest === null
        ? null
        : {
            formatVersion: validation.manifest.formatVersion,
            applicationVersion: validation.manifest.applicationVersion,
            createdAt: validation.manifest.createdAt,
            timeZone: validation.manifest.timeZone,
          },
    issues: validation.issues,
    autoFixable,
    needsBackup,
    suggestions,
  };
}
