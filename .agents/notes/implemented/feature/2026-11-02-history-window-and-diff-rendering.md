# Agent Note: 历史窗口、快照选择与双列 diff 渲染

Status: implemented

[English](2026-11-02-history-window-and-diff-rendering.en.md) | 中文

## Problem

历史能力只有在「区间边界、快照选择、权限裁剪、diff 渲染」四件事都确定时才可解释。[05](../../../../plan/fullstack-design/05-api-design.md) §5.3/§6.14 与 [07](../../../../plan/fullstack-design/07-backend-implementation.md) §8.2 定了 `[start,end)`、before/after 取法、created/deleted 语义与 `currentlyDeleted`，[08](../../../../plan/fullstack-design/08-frontend-implementation.md) §4.3 定了用 jsdiff `diffLines`；但没有定本地 00:00 如何换算 UTC、同毫秒如何决胜、成员「当前相关任务的历史」如何取、列表排序，以及双列行模型如何处理缺失末尾换行。这些直接决定边界是否漏算、成员是否会看到他人历史、以及 diff 是否会把「追加一行」显示成整段替换。

## Decision

- **区间在服务端解析**：`default` = manifest 时区「昨天 00:00」→ now；`custom` = startDate 00:00 → endDate 次日 00:00（包含结束日全天）。响应返回实际 UTC 边界与 manifest 时区；本地 00:00 用 `Intl.DateTimeFormat` 反解 UTC 瞬间，DST 由该函数按目标时区规则处理。
- **快照选择**：`before` 取 `recordedAt < start` 的最后一条，`after` 取 `recordedAt < end` 的最后一条；同毫秒以 `taskVersion` 决胜。`after = null` 跳过；`before = null` 且 after 是删除 → `deleted`；`before = null` 其他 → `created`（不伪造空起点）；否则比较 progress/detailText，只有两者变化才算 `updated`，分配/重要度变化忽略。
- **currentlyDeleted 与 owners**：`currentlyDeleted` 取查询时 current 的 `deletedAt`（updated 也可能为 true）；`owners` 取 after/delete 快照的 owner 分配，成员档案缺失时给「待分配」。
- **成员可见历史只认主任务分配**：候选 = 当前主任务 owner/collaborator ∪ after/delete 快照中主任务 assignment 命中当前成员的聚合；仅小任务被分配者被排除（否则历史会返回主任务完整 detail，绕过 #18 的脱敏）。`memberIds` 只能选可见任务里出现的成员，否则 400；管理员 `memberIds` 按 after 快照 owner ∩ active 成员过滤。
- **排序**：非 `currentlyDeleted` 在前，`currentlyDeleted` 固定置底；组内按 `after.recordedAt` 降序、`taskId` 升序，保证分页/刷新稳定。
- **diff 在前端**：服务端只返回完整快照，不保存 diff。`buildDiffColumns` 是纯函数：CRLF→LF、非空文本补末尾换行后调用 jsdiff `diffLines`，把 removed/added/unchanged 展平为左右两列（blank 占位保持行对齐）。缺失末尾换行若不补齐，jsdiff 会把「追加一行」判成整行删除+新增。
- **渲染安全**：双列所有文本只经 Vue 插值，禁用 `v-html`；`<script>` 只作为文本显示。区间内创建不伪造空文本 diff，左列显示「起始时不存在」。

## Alternatives considered

- 服务端计算并返回 diff：会把行级结果写进 API/存储，违背「存储不保存 diff 结果」且限制前端渲染选择 — 否决。
- 用 UTC 计算「昨天 00:00」：非 UTC 用户会在本地清晨看到错误边界 — 否决；统一 manifest 时区。
- 自己实现 LCS：08 §4.3 已确认 jsdiff，自研只会增加边界 bug 与维护成本 — 否决。
- 对分配/重要度变化也生成 updated：会让历史列表被大量非进度变化淹没，且 02 §7 只要求进度/详情 diff — 否决。
- 在 DTO 之外补 cursor 分页：05 §5.3 响应没有 cursor 字段，本轮先按稳定排序返回全量；量级变大时再按契约升级 — 暂缓。

## Consequences

- 管理员与成员使用同一历史服务与同一 diff 组件，边界、排序与徽章一致；成员范围先裁剪再计算。
- 仅小任务被分配者没有主任务级历史（不在首版范围）；若将来需要小任务历史，必须单独设计脱敏后的快照投影。
- `currentlyDeleted` 的 updated 项也会置底并显示「当前已删除」，历史可读性优先于按 changeKind 分组。
- 大文本 diff 在可见页内计算并缓存于组件 computed；当前没有 Web Worker，超长文本会在主线程计算，后续按实际性能再引入。
- 双列行对「缺少末尾换行」做语义归一：只追加一行不再显示为整段替换，但「文件末尾换行本身变化」不会单独出现在 diff 中。
