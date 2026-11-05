# SQLite 存储迁移冒烟（2026-11-05）

环境：Node 25.9（CI 同时跑 Node 22+），macOS，`ztask serve` + `better-sqlite3` + Kysely Migrator。

## 步骤与结果

1. 全新数据目录启动：`ztask serve --data-dir /tmp/ztask-better-sqlite3-smoke --port 18126 --no-open`。
   - `/api/v1/health` 200；数据目录只生成 `ztask.db`、`ztask.db-wal`、`ztask.db-shm`，没有旧 `members/`、`tasks/` 等目录。
2. 通过管理 API 创建 1 个任务夹及其子夹、2 个成员、3 个主任务和 1 个子任务；主任务更新进度到 70、详情并产生 2 条 revision，另外两个任务分别为 40、100。
3. 停止并重启同一数据目录；`GET /api/v1/admin/tasks` 仍返回 3 个任务（progress=70/40/100，主任务 version=2），历史 revision 保留。
4. `ztask doctor --data-dir /tmp/ztask-better-sqlite3-smoke`：健康，未发现问题；报告显示 schema 版本 1、时区 Asia/Shanghai。
5. `ztask backup --url http://127.0.0.1:18126`：生成 `backups/<UTC>-<uuid>/ztask.db` + `backup.json`，报告 `files=1`、`bytes=172032`、`schemaVersion=1`，各表行数正确。
6. `ztask restore --backup <backup> --data-dir /tmp/ztask-better-sqlite3-restored`：恢复摘要 3 个主任务、2 个任务夹、2 个成员；`doctor` 健康。
7. 在恢复目录启动服务，`GET /api/v1/admin/tasks` 与看板 summary 仍返回 3 个任务和 progress=70/40/100；看板 done=1、gt50=1、lt50=1，备份/恢复链路完整。
8. 浏览器冒烟（Playwright + Chrome，1440×900）：
   - `board.png`：任务管理视图，显示 3 个任务、子任务、负责人与进度；主任务详情注明 better-sqlite3 连接层已切换。
   - `dashboard.png`：情况看板，三个进度桶、成员筛选与历史变化（区间内创建/进度 70%）。

## 截图

- ![任务管理](board.png)
- ![情况看板](dashboard.png)

## 版本升级/降级冒烟（schema 变更）

在 `/tmp/ztask-version-smoke`（v1 数据库，3 个任务）上模拟一次新版本 migration：

1. 给应用临时增加 `0002_probe` migration（新增 `v2_probe` 表）并把 `SCHEMA_VERSION` 提升到 2，编译后在 v1 数据目录直接启动。
   - 启动自动应用 `0001_initial` 之后的 `0002_probe`，`user_version=2`，`kysely_migration` 含两项，`v2_probe` 表存在，3 个任务数据完整；无需手工执行迁移命令。
2. 恢复 v1 代码并重新编译，在已被升级到 v2 的同一数据目录启动。
   - 启动被拒绝，退出码 1：`UnsupportedFormatError: 数据库 schema 版本 2 高于应用支持的 1，请先升级应用`（`code=STORAGE_UNSUPPORTED_FORMAT`）。
   - 失败后库内仍是 3 个任务、`user_version=2`、`v2_probe` 存在，没有被旧版本改写。
3. 回归测试 `tests/storage/version-guard.spec.ts` 覆盖：`user_version` 高于应用、`kysely_migration` 含未知 migration、已应用 migration 的 checksum 被改动，三种情况都拒绝启动。

结论：升级是启动时自动迁移；降级不会静默运行，而是被版本/未知 migration 门禁拒绝。需要降级时只能先升级应用，或从升级前的旧备份恢复。
