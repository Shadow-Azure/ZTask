# Agent Note: 存储提交协议的索引新鲜度与运行时恢复边界

Status: implemented

[English](2026-11-02-storage-write-protocol-recovery-boundaries.en.md) | 中文

## Problem

[全栈设计](../../../../plan/fullstack-design/06-database-design.md) 06 §8.2 与 04 §5.2 要求任务提交协议以"更新内存索引"收尾，且 current/索引失败时立即重建恢复。m2-file-storage（#13）交付存储层时没有任何查询服务消费索引，而引入进程内 degraded 状态机只为满足字面顺序，会把无受益者的复杂度提前带进写路径。

## Decision

#13 的提交协议止步于"原子发布 current"：队列内复查 expectedVersion → 追加 revision（append+fsync 是逻辑提交点）→ 原子发布 current。`commit` 不更新运行时索引；索引新鲜度由两处提供——启动 `initStore` 全量重建，以及显式 `rebuildIndexes()`。运行时"append 后、current 发布失败"只把错误交回调用方，持久化一致性恢复推迟到下次启动（启动恢复覆盖真实崩溃窗口，current 落后 tip 即重建）。#15 接入 task-service 时必须在提交路径补索引失效/重建，并为索引更新步骤补故障注入缝。

## Alternatives considered

每次提交后同步重建全部索引：v1 数据量小可行，但把查询口径耦合进写路径、每次全量重扫，且在没有任何查询消费者时是纯开销。进程内 degraded 状态机（发布失败即标记并暂停读写）：严格满足 04 §5.2 字面顺序，但没有消费者受益，且要把 degraded 语义贯穿健康检查与路由层，属于 #15 的职责面。

## Consequences

`store.indexes` 是启动快照，不随提交自动更新——#15 之前任何索引消费者必须先 `rebuildIndexes()` 或实现提交驱动的增量更新。运行时发布失败的窗口内，旧 expectedVersion 的重试会得到版本冲突（文件已是新版本），不会产生同号幻影 revision；跨进程的一致性始终由启动恢复兜底。本 Note 是 #15 实现提交驱动索引更新与注入缝时的防遗漏锚点。
