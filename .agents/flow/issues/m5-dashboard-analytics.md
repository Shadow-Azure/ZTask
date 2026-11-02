# 看板统计、成员过滤与预计完成分布

[English](m5-dashboard-analytics.en.md) | 中文

```yaml flow
kind: issue
milestone: m5
priority: P1
status: in-progress
scope:
  - apps/server/src/modules/dashboard/**
  - apps/server/src/modules/share/**
  - apps/server/src/app.ts
  - apps/server/src/index.ts
  - tests/member-access/**
  - apps/web/src/features/dashboard/**
  - .agents/notes/implemented/feature/2026-11-02-*
  - apps/web/src/api/share.ts
  - apps/web/src/api/admin.ts
  - apps/web/src/features/tracker/**
  - packages/shared/**
  - tests/dashboard/**
  - tests/web-shell/**
  - .agents/flow/issues/m5-dashboard-analytics*
adr: []
github:
  number: 21
  url: https://github.com/Shadow-Azure/ZTask/issues/21
```

## 背景

原型看板不仅是图表展示，还依赖统一统计口径和成员数据裁剪；必须复用相同服务避免管理端与成员端数字漂移。

## 目标

- 实现三统计卡、任务状态/重要度堆叠柱、成员过滤和预计完成日期分布。
- 管理员全量与成员相关任务复用同一统计服务，空数据口径明确。
- 实现 15 秒轮询、后台暂停、聚焦刷新及任务/看板 tab。

## 设计依据

- `plan/fullstack-design/`：02 §7–8、05 §5.1–5.2 与 §6.12–6.13、07 §4、08 §7–8。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 统计只使用 active 分配与设计规定的有效任务集合，归档/删除不重复计数。
- 图表使用 CSS/SVG 和文本可访问名称，不引入重量级图表库。
- 成员过滤器在分享域不可用于探测其他成员。

## 实施步骤

1. 先写统计口径表和边界 fixture，包括逾期、无日期、归档与删除。
2. 实现 dashboard service/API，再连接图表与轮询。
3. 对照原型验证管理员和 A/B 成员的不同范围。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行统计单元、API 契约和浏览器截图测试，逐项核对统计卡、堆叠柱、日期面板与筛选结果。

## 验收标准

- 同一数据范围内各图表和卡片计数一致，管理端与成员端权限边界正确。
- 空态、无预计日期和后台恢复轮询无错误。
- 图表视觉、标签与响应式布局符合原型。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不做可配置 BI、导出报表、SSE/WebSocket 或跨成员统计探测。
