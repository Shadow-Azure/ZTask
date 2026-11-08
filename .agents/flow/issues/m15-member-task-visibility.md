# 成员链接全团队任务可见与负责人写边界

[English](m15-member-task-visibility.en.md) | 中文

```yaml flow
kind: issue
milestone: m15
priority: P0
status: ready
scope:
  - apps/server/src/modules/share/**
  - scripts/doc-budgets.manifest.json
  - scripts/prototype-tracker.spec.mjs
  - apps/server/src/modules/dashboard/**
  - apps/server/src/modules/revisions/**
  - apps/web/**
  - packages/shared/**
  - tests/**
  - plan/fullstack-design/**
  - plan/m1-01-ui-prototype/**
  - .agents/notes/implemented/feature/2026-11-08-share-all-task-visibility*
  - .agents/notes/implemented/feature/2026-11-02-member-owner-write-boundary*
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m15-*
  - .agents/flow/issues/m15-*
adr:
  - ../../notes/implemented/feature/2026-11-08-share-all-task-visibility.md
  - ../../notes/implemented/feature/2026-11-02-member-owner-write-boundary.md
github:
  number: 97
  url: https://github.com/Shadow-Azure/ZTask/issues/97
```

## 背景

成员链接原先只返回 owner/collaborator 相关任务，个人页只有“我负责的/我协作的”两组，事项跟踪、看板与历史也按同一范围裁剪。用户已确认：成员可查看团队全部任务，只有主任务负责人能编辑自己的进度、详情和小任务；个人页三组默认展开且标题可折叠。代码、原型与设计文档需要同步到新口径。

## 目标

- `/share/tasks` home 返回 owned/collaborated/others 三组；tracker、任务夹树、看板与历史返回团队全量。
- 成员详情 DTO 保留完整 detail 与全部未删除小任务，`memberRole` 增加 viewer；非 owner 写返回 403。
- 成员个人页展示三组，默认展开、标题可折叠；其他成员卡只读标识。
- 事项跟踪保持完全只读；负责人编辑只在个人页。
- 同步设计文档、Agent Note、原型与测试。

## 设计依据

- `plan/fullstack-design/02-features.md` §4–5、`05-api-design.md` §6、`07-backend-implementation.md` §5.1、`08-frontend-implementation.md` §6。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 与用户确认的三组/折叠截图。
- `2026-11-08-share-all-task-visibility` Agent Note。

## 实施步骤

1. 调整 share scope、routes、DTO 与写权限校验；删除 dashboard/history 的成员裁剪分支。
2. 成员个人页增加 others 组、只读徽标与三组折叠；事项跟踪复制与角色文案更新。
3. 更新服务端、前端、e2e 测试与全栈设计文档。
4. 用真实应用截图留存修改前后对比，跑全量门禁。

## 独立验证

```sh
pnpm test
pnpm lint:docs
pnpm verify:docs
pnpm verify:flow
```

## 验收标准

- home 三组不重不漏；tracker/tree/dashboard/history 覆盖全团队。
- 非 owner 写 403；不存在/软删除/小任务 id 404；owner 写仍过 version 与 revision 协议。
- 个人页默认展开、可折叠、其他成员只读；tracker 完全只读。
- 文档、原型、测试与实现一致。

## 非目标

- 逐任务私密可见性、账号体系、成员管理页开放、折叠状态跨会话持久化。
