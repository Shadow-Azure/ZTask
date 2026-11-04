# 修复情况看板切换人员筛选重置时间段

[English](m10-dashboard-filter-sync.en.md) | 中文

```yaml flow
kind: issue
milestone: m10
priority: P1
status: in-progress
scope:
  - apps/web/**
  - tests/**
  - reports/**
  - .agents/flow/**
  - scripts/doc-budgets.manifest.json
  - .gitignore
adr: []
github:
  number: 68
  url: https://github.com/Shadow-Azure/ZTask/issues/68
```

## 背景

2026-11-04 的冒烟测试发现：在情况看板提交自定义时间段后再切换人员筛选，`changes` 请求会从 `mode=custom&startDate&endDate` 回退为 `mode=default`，日期控件也被重置为“昨天至今”，导致任务进展变化混入所选时间段之外的记录。证据见 `reports/2026-11-04/dashboard-member-filter/`。

根因是成员筛选切换会更换 `summary` 的 query key，`summaryQuery.isLoading` 短暂为真时整个内容区被 `LoadingState` 替换，`ChangesPanel` 随之下卸载重挂，局部 `submitted` 区间回到默认。

## 目标

- `summary` 查询在成员筛选切换时保留上一份数据，避免内容区与 `ChangesPanel` 被卸载。
- 人员筛选刷新继续使用已提交的 `mode`、`startDate`、`endDate`，并叠加新的 `memberIds`。
- 新增组件回归用例，覆盖“自定义区间后再切换成员”的请求与控件状态；修复前失败、修复后通过。
- 在真实构建与真实 API 上复验，并更新冒烟报告的修复后证据。

## 验收

- 自定义 2026-11-04 后筛周舟：状态行仍为“自定义日期”，日期控件保持 11-04，结果为空态。
- 自定义 2026-11-04 后筛陈晨：仍只显示陈晨相关的 A/D，请求带 `mode=custom`、起止日期与 `memberIds`。
- 自定义 2026-11-03 后切换成员，仍保持 11-03 区间，不回退默认。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:flow` 通过；浏览器冒烟无 console error。
- 冒烟报告将 P1 标记为已修复，并保留修复前/后截图对照。
