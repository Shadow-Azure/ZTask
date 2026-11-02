# 事项跟踪只读卡与任务树体验

[English](m3-tracker-experience.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P1
status: in-progress
scope:
  - apps/web/src/features/tracker/**
  - apps/web/src/features/tasks/**
  - apps/web/src/components/**
  - tests/tracker/**
  - apps/web/src/pages/TrackerPage.vue
  - .agents/flow/issues/m3-tracker-experience*
adr: []
github:
  number: 17
  url: https://github.com/Shadow-Azure/ZTask/issues/17
```

## 背景

任务 API 完成后，需要把原型左树右板、统一只读卡和可调分栏转成真实数据体验，且保持查看与编辑边界清晰。

## 目标

- 实现任务夹树、搜索筛选、展开折叠、任务列表和完整小任务摘要。
- 统一只读任务卡直接展示进展，编辑仅通过明确入口打开浮窗。
- 实现可调分栏、任务/看板 tab 占位、空态和响应式布局。

## 设计依据

- `plan/fullstack-design/`：02 §3 与 §8、03 §5–9、08 §3–4 与 §8–9、原型 tracker 页面。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 查询参数驱动服务端筛选与树结果，卡片禁行内隐式编辑。
- 任务卡、进度环、逾期标签和重要度颜色复用 M2 组件。
- 为 deleted/current 状态和大数据列表保留后续看板/历史展示接口。

## 实施步骤

1. 先用 API 夹具写树、筛选和卡片交互测试。
2. 接入真实查询，完成分栏和编辑器入口。
3. 按原型桌面/窄屏截图走查并修正键盘操作。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行 tracker 组件与浏览器测试，检查筛选、树选择、卡片详情、编辑器入口、分栏拖动和刷新恢复。

## 验收标准

- 任务树、列表、卡片、小任务与详情数据一致，无重复嵌套或陈旧缓存。
- 统一卡无旧版行内编辑残留，视觉与原型一致。
- 键盘和窄屏可完成查看及打开编辑器。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不实现成员访问控制、看板图表和历史 diff。
