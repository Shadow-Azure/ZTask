# 情况看板增加卡片任务列表与任务浮窗

[English](m16-dashboard-card-task-list.en.md) | 中文

```yaml flow
kind: issue
milestone: m16
priority: P1
status: ready
scope:
  - plan/m1-01-ui-prototype/**
  - plan/fullstack-design/**
  - scripts/prototype-tracker.spec.mjs
  - scripts/doc-budgets.manifest.json
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m16-*
  - .agents/flow/issues/m16-*
  - .agents/notes/implemented/feature/2026-11-08-dashboard-card-task-list*
  - apps/web/src/**
  - apps/server/src/**
  - packages/shared/src/**
  - tests/dashboard/**
adr:
  - ../../notes/implemented/feature/2026-11-08-dashboard-card-task-list.md
github:
  number: 92
  url: https://github.com/Shadow-Azure/ZTask/issues/92
```

## 背景

情况看板的统计卡片只展开预计完成时间分布柱状图，用户看到「已完成 2 项」或「进行中 3 项」后，无法知道具体是哪些任务，也不能从统计直接打开任务详情。任务管理页的列表承担增删改查与筛选，不适合作为「先看统计、再看明细」的第二跳。原型版式已由用户截图确认，现进入真实实现。

## 目标

- 真实 `apps/web` 看板在柱状图下方显示该集合的分页任务列表。
- 列表简洁紧凑：每页 5 项，行内展示重要度、任务描述、负责人、进度与截止日期。
- 点击任务行打开现有任务详情浮窗：管理员进入编辑浮窗，成员域进入只读详情。
- 卡片切换、成员筛选或任务夹变化时回到第一页；数据刷新时保持分页有效。
- 看板列表只读，不改变三统计卡与分布图的口径。

## 实现内容

- `packages/shared/src`：新增看板任务行与分页响应 DTO（`DashboardTaskListItem`、`DashboardTasks`），并导出。
- `apps/server/src/modules/dashboard`：服务层复用 `scopedAggregates` 的 folder/member/share 口径，新增按进度桶过滤、`createdAt,id` 稳定排序与 opaque cursor 分页的任务明细；管理端与分享域新增 `GET /dashboard/tasks`。
- `apps/web/src/api`：新增 `dashboardTasks` 方法（管理员/分享域）。
- `apps/web/src/features/dashboard/DashboardPanel.vue`：图下任务列表、5 项/页、游标栈翻页、加载/错误/空态与 15s 刷新；行点击 emit `openTask`。
- `apps/web/src/features/tracker/TrackerView.vue`：看板行复用任务打开逻辑（管理员编辑浮窗 / 成员只读详情）。
- `tests/dashboard`：服务端游标、桶过滤、成员/分享域范围、非法 cursor，以及组件列表渲染、翻页、重置与任务行事件测试。
- `plan/m1-01-ui-prototype/review/90–98`：真实应用修改前后截图与浮窗截图。
- 本次同时保留已确认的静态原型、规格测试与评审截图。

## 独立验证

```sh
pnpm test
pnpm lint:docs
pnpm verify:docs
pnpm verify:flow
```

- `pnpm test`：64 个测试文件、476 个测试全部通过（含新增看板 API/组件用例）。
- 真实应用以 2026-11-08 数据在 1440×1000 视口验证：第 1 页 5 行、页脚 1/2，翻页到第 2 页显示剩余 2 行，点击任务行打开对应任务浮窗。
- 文档、配对、类型等门禁与流程门禁通过。

## 非目标

- 不改变三统计卡、预计完成分布、时间段历史或成员可见范围。
- 不重做任务管理页任务列表，也不新增任务数据协议。
