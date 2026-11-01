# Agent Note: 删除任务的历史展示与边界

Status: implemented

[English](2026-11-01-deleted-task-history.en.md) | 中文

## Problem

后端可实施性审查发现任务分配、revision 返回和历史查询存在契约缺口：主任务与小任务分配无法区分、no-op 没有合法 revision 返回、start 边界会漏变更、软删除任务可能被历史候选集合排除。原型也没有表达“任务当前已删除但区间内仍有历史变化”的展示方式。

## Decision

主任务聚合继续使用 [current.json](../../../../plan/fullstack-design/06-database-design.md)，assignment 增加 taskId，唯一性按 `(taskId,memberId)` 判断。任务写服务返回 aggregate 与 nullable revision，no-op 不伪造快照。历史窗口统一为 `[start,end)`，候选包含软删除任务，权限采用当前相关任务的历史，created-then-deleted 以 deleted 为主状态。历史响应独立返回 currentlyDeleted，前端将该类任务标记“当前已删除”并固定置底，即使 changeKind 是 updated 也按当前删除状态展示。原型用“历史遗留报表迁移”覆盖删除快照和当前徽章，当前树、列表、计数与统计继续排除删除任务。

## Alternatives considered

未采用 `(start,end]` 或仅比较当前 active 索引，因为前者漏掉 start 精确时刻，后者无法展示删除事件。未把 before=null 一律视为创建，因为同区间创建后删除需要 deleted 优先。未使用 changeKind 代替 currentlyDeleted，因为任务可能在查询结束后才删除。未让删除任务留在当前树中，因为历史可见性与当前管理范围是不同口径。

## Consequences

[05 API](../../../../plan/fullstack-design/05-api-design.md)、[06 文件存储](../../../../plan/fullstack-design/06-database-design.md) 与 [07 后端实现](../../../../plan/fullstack-design/07-backend-implementation.md) 对小任务 DTO/version、稳定分页、归档索引、缺失服务方法和 LAN 关闭语义也形成一致契约。原型测试覆盖 active/history 范围、半开边界、创建状态、删除徽章和置底排序，24 项全部通过；修改前后截图保存为 `50-before-deleted-history.png` 与 `51-after-deleted-history.png`。
