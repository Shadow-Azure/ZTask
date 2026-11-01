# 任务聚合、编辑器与历史写入

[English](m3-task-mutations.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P0
status: backlog
scope:
  - apps/server/src/modules/tasks/**
  - apps/server/src/modules/revisions/**
  - apps/web/src/features/tasks/**
  - packages/shared/**
  - tests/admin-tasks/**
  - .agents/flow/issues/m3-task-mutations*
adr: []
github:
  number: 16
  url: https://github.com/Shadow-Azure/ZTask/issues/16
```

## 背景

主任务与一层小任务是产品核心，必须把完整字段、分配、版本与历史写入一次贯通，避免 UI 和存储各自解释聚合。

## 目标

- 实现任务查询、创建、完整详情读取、进度/详情更新、编辑器 PUT 与软删除。
- 支持一层小任务、owner/collaborator 分配、重要度、预计完成时间和聚合 version。
- 每次有效变更追加完整快照；409 保留用户草稿。

## 设计依据

- `plan/fullstack-design/`：02 §3、05 §3.4–3.9、06 §6–8、07 §3–4、08 §4。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- service 统一校验层级、角色、归档成员和字段不变量；PUT 仅覆盖设计允许的编辑字段。
- 前端实现新建/编辑浮窗、完整详情、小任务管理和删除确认。
- 列表、详情与树 mutation 后按查询键失效，不能用旧响应覆盖未保存草稿。

## 实施步骤

1. 先建立 DTO、错误码和并发/历史契约测试。
2. 实现任务 service 与 API，再实现编辑器和缓存更新。
3. 验证无操作写、软删除、非法第二层小任务和冲突恢复。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行任务 API、revision 和编辑器组件测试；两个客户端并发保存，确认一条 409 且草稿可重试，重启检查快照。

## 验收标准

- 管理员可完成主任务和小任务全生命周期，所有字段与设计 DTO 一致。
- 无有效变化不制造 revision；软删除保留历史。
- 并发冲突可见、可恢复，不丢未提交文本。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不实现历史查询 UI、成员端写入、看板统计或永久物理删除。
