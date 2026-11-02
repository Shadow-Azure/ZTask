# 任务夹与成员档案管理

[English](m3-folders-members.en.md) | 中文

```yaml flow
kind: issue
milestone: m3
priority: P0
status: in-progress
scope:
  - apps/server/src/modules/folders/**
  - apps/server/src/modules/members/**
  - apps/web/src/features/folders/**
  - apps/web/src/features/members/**
  - packages/shared/**
  - tests/admin-members/**
  - apps/server/src/app.ts
  - apps/server/src/bootstrap.ts
  - apps/web/src/pages/TrackerPage.vue
  - apps/web/src/pages/MembersPage.vue
  - apps/web/src/App.vue
  - .agents/flow/issues/m3-folders-members*
adr: []
github:
  number: 15
  url: https://github.com/Shadow-Azure/ZTask/issues/15
```

## 背景

任务依赖任务夹与负责人/协作者引用，需先提供稳定的管理能力；成员归档与分享链接生命周期应分离。

## 目标

- 实现嵌套任务夹 CRUD、树排序与删除约束。
- 实现成员创建、重命名、角色信息、归档和查询，归档不重写任务聚合。
- 完成原型成员表格与确认 Dialog，刷新后状态保持。

## 设计依据

- `plan/fullstack-design/`：02 §3、05 §3.1–3.3 与 §4.1–4.4、06 §4、08 §3。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 服务端校验父级、环、非空名称和成员引用；归档成员从 active 索引与分配控件排除。
- 前端提供任务夹树操作和成员维护浮窗，危险操作展示影响说明。
- 本阶段不生成或展示可复制的分享链接。

## 实施步骤

1. 先写层级与归档契约测试。
2. 实现服务端路由和存储事务，再连接管理端组件。
3. 覆盖删除有内容任务夹、归档已分配成员和刷新恢复。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行文件夹/成员 API 契约测试和浏览器管理主链路，重启后检查树、成员状态和任务引用。

## 验收标准

- 非法层级、删除约束与归档行为返回设计规定的错误。
- 归档成员的历史任务仍可读，新分配不可选择该成员。
- 桌面与窄屏成员管理交互与原型一致。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不实现令牌、网络配置、成员端页面或任务编辑器。
