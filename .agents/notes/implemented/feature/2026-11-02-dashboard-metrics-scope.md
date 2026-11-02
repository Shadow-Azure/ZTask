# Agent Note: 看板统计口径与双域复用

Status: implemented

[English](2026-11-02-dashboard-metrics-scope.en.md) | 中文

## Problem

看板要同时服务管理员（全团队 + 成员筛选）与成员（仅自己相关任务），[02](../../../../plan/fullstack-design/02-features.md) §7 与 [05](../../../../plan/fullstack-design/05-api-design.md) §5.1–5.2 / §6.12–6.13 定了三桶、重要度计数、成员过滤与 due 分布，但没有定四件事：成员域如何复用同一统计、归档 owner 的分配算不算 active、`dueDate=null` 进不进分布、以及「今天」用哪个时区。它们直接决定两端数字是否一致、空数据是否可解释。

## Decision

- **一个 service 服务两个域**：`createDashboardService({ dataDir, timeZone })` 同时供 admin 与 share 路由；差异只在「任务范围」：管理员 = 任务夹及后代（可选 memberIds 过滤），成员 = `isRelated` 相关任务再与任务夹范围求交。
- **只统计主任务**：跳过软删除与 `deletedAt !== null` 的小任务，避免父子重复计数。
- **active 分配口径**：成员筛选只认「未归档成员作为主任务 owner」的分配；空选择 = 全部成员，多成员 OR；`memberIds` 必须是 UUID，否则 400；格式合法但已归档/不存在 → 200 空集。
- **成员域不接受 `memberIds`**：带该参数一律 400，避免通过看板探测其他成员的任务量；无会话仍先 401。
- **三桶互斥**：`done=100`、`gt50=51–99`、`lt50=0–50`，每桶附 high/mid/low（取主任务 `importance`）。
- **due 分布按 manifest 时区**：用 `Intl.DateTimeFormat("en-CA", { timeZone })` 求「今天」，再以 UTC 日期差计算 `overdue(<0)`、`week(0–7)`、`month(8–30)`、`later(>30)`；`dueDate=null` 不进入分布（DTO 无「未排期」键），固定返回四桶；`asOf` 与「今天」用同一个 clock。
- **未知 folderId 显式空集**：不统计孤儿任务，也不报 404，与任务列表的空集语义一致。

## Alternatives considered

- 管理员与成员各写一套统计代码：必然出现两端数字漂移，且筛选/边界要维护两份 — 否决。
- 把 `dueDate=null` 归入 `later`：会让「没排期」看起来像「一个月后完成」，误导排期决策 — 否决；记为已知缺口，待 DTO 增加 unscheduled 桶再处理。
- 按「任意分配（owner/collaborator）」做成员筛选：协作者会把任务算进自己的统计，与 02 §7 的 owner 口径冲突 — 否决。
- 用 UTC 计算今天：用户在中国时区早上 8 点前会看到昨天的分桶 — 否决；统一读 manifest 时区。
- 在成员域开放成员筛选但裁剪结果：仍可通过数字差异推断他人任务量 — 否决。

## Consequences

- 相同范围下管理员与成员看到完全一致的三桶与 due 分布；成员域没有成员筛选入口。
- `dueDate=null` 的主任务计入三统计卡，但不进入 due 分布；后续若新增「未排期」桶需同步 05 §2.2 与前端图例。
- 看板数据来自同一份派生读取（每次请求重读聚合），没有独立缓存；15s 轮询与后台暂停由前端控制（03 §7）。
