import type { FastifyInstance } from "fastify";
import type { ZtaskStore } from "../../storage/store.js";
import { createBackupService, type BackupHooks, type BackupResult } from "./backup-service.js";

/** 维护端点基址；全部位于 `/api/v1/admin` 前缀，因此 LAN listener 上由统一守卫 403。 */
export const MAINTENANCE_ADMIN_PATH = "/api/v1/admin/maintenance";

/** 在线备份端点（05 §4 管理端；06 §10、07 §9）。 */
const BACKUP_PATH = `${MAINTENANCE_ADMIN_PATH}/backup`;

/** maintenanceRoutes 的装配项。 */
export interface MaintenanceRoutesOptions {
  dataDir: string;
  /** 发起备份的应用版本（写入 backup.json 报告）。 */
  appVersion: string;
  /** 共享存储门面；备份通过它的 pauseWrites 建立一致性边界。 */
  store: ZtaskStore;
  clock?: () => Date;
  /** 备份故障注入缝（测试用）。 */
  backupHooks?: BackupHooks;
}

/**
 * 管理端维护路由（#23）：POST /api/v1/admin/maintenance/backup。
 *
 * - 成功 201：`{ backupDir, report }`，报告同时落盘为备份目录内的 `backup.json`；
 * - 备份进行中 409 `BACKUP_IN_PROGRESS`（同进程串行，不并发复制同一数据目录）；
 * - 校验/复制失败 500：不留半备份；
 * - LAN listener 上由 app 级 Admin 守卫统一 403 `ADMIN_LOCAL_ONLY`。
 * 恢复与 doctor 只离线执行（CLI），不暴露 HTTP 写入口。
 * @param app Fastify 实例。
 * @param options 装配项（dataDir、appVersion、store 与故障注入缝）。
 */
export async function maintenanceRoutes(
  app: FastifyInstance,
  options: MaintenanceRoutesOptions,
): Promise<void> {
  const backupService = createBackupService({
    dataDir: options.dataDir,
    appVersion: options.appVersion,
    timeZone: options.store.manifest.timeZone,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    pauseWrites: () => options.store.pauseWrites(),
    ...(options.backupHooks === undefined ? {} : { hooks: options.backupHooks }),
  });

  app.post(BACKUP_PATH, async (_request, reply) => {
    const result: BackupResult = await backupService.create();
    return await reply.status(201).send(result);
  });
}
