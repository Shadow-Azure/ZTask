# 成员个人页负责人写入与协作者只读

[English](m4-member-authoring.en.md) | 中文

```yaml flow
kind: issue
milestone: m4
priority: P1
status: done
scope:
  - apps/server/src/modules/share/**
  - apps/web/src/features/share/**
  - apps/web/src/features/tasks/**
  - apps/web/src/pages/MemberHomePage.vue
  - packages/shared/**
  - tests/member-authoring/**
  - tests/member-access/**
  - apps/web/src/api/share.ts
  - apps/web/src/api/http.ts
  - apps/server/src/modules/tasks/**
  - apps/server/src/app.ts
  - .agents/notes/implemented/feature/2026-11-02-*
  - .agents/flow/issues/m4-member-authoring*
adr: []
github:
  number: 19
  url: https://github.com/Shadow-Azure/ZTask/issues/19
```

## 背景

成员个人页允许负责人维护执行任务，但权限明显小于管理员；需要在同一聚合上实现最小写入并保持协作者和 tracker 只读。

## 目标

- 个人页区分“我负责的”和“我协作的”任务卡。
- owner 可保存主任务进度、完整详情并新建/编辑/删除一层小任务。
- collaborator 全部只读，任何成员都不能编辑分配或新建顶级任务。

## 设计依据

- `plan/fullstack-design/`：02 §4–5、05 §6.6–6.10、07 §3、08 §6.2 与 §9。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 每个写端点同时校验 session member、link 状态、owner 关系和父聚合 version。
- 成员新建小任务默认当前成员 owner，不开放主任务描述、重要度、任务夹或删除主任务。
- 409 时保留进度、详情和小任务草稿；成功后刷新管理员和成员可见查询。

## 实施步骤

1. 先写 owner/collaborator/跨成员写权限矩阵。
2. 实现受约束 API 和个人页 mutation，再补齐冲突草稿行为。
3. 验证协作者直接调用写端点也无法改变数据。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行成员写 API 与个人页浏览器测试，覆盖 owner 成功、collaborator 拒绝、409、软删除小任务和历史快照。

## 验收标准

- owner 三项写入均持久化并产生正确 revision，collaborator 写请求被拒绝。
- 页面不出现管理员专属控件，事项跟踪仍完全只读。
- 并发冲突不丢草稿，刷新后角色分组与数据正确。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不允许成员修改主任务分配、所属夹、重要度、预计完成时间或删除主任务。
