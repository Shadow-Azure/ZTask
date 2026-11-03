# 任务管理原型新增负责人多选筛选

[English](m8-assignee-multiselect-filter.en.md) | 中文

```yaml flow
kind: issue
milestone: m8
priority: P1
status: in-progress
scope:
  - plan/m1-01-ui-prototype/**
  - plan/fullstack-design/**
  - scripts/prototype-tracker.spec.mjs
  - scripts/doc-budgets.manifest.json
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m8-prototype-filter-refinement*
  - .agents/flow/issues/m8-assignee-multiselect-filter*
  - .agents/notes/implemented/feature/2026-11-03-assignee-multiselect-filter*
adr:
  - ../../notes/implemented/feature/2026-11-03-assignee-multiselect-filter.md
github:
  number: 62
  url: https://github.com/Shadow-Azure/ZTask/issues/62
```

## 背景

任务管理原型目前只有重要度与关键词搜索，无法按负责人快速定位任务。负责人信息同时存在于主任务与子任务上，筛选时需要区分两种命中范围，否则会出现主任务被错误隐藏或无关子任务混入结果的情况。

## 目标

- 在重要度筛选右侧、搜索框左侧新增负责人多选下拉，支持搜索成员、多选与清除。
- 主任务负责人命中时保留整条任务及其全部子任务，即使部分子任务由其他人负责。
- 仅子任务负责人命中时保留主任务，但只显示该负责人负责的子任务，并在卡片内标明已按负责人筛选。
- 负责人筛选与重要度、关键词搜索同时生效，三者取交集。
- 保留修改前后的原型对比截图，供界面评审。
- 同步更新 `plan/fullstack-design` 中任务管理筛选、列表 API、派生索引与前端实现的设计契约。

## 实现内容

- `plan/m1-01-ui-prototype/ztask-prototype.html`：负责人多选筛选组件、`taskAssigneeMatch` 纯函数、任务卡片的子任务子集渲染与筛选提示。
- 调整一条示例子任务的负责人，使原型可演示“子任务负责人不是主任务负责人”的分支。
- `scripts/prototype-tracker.spec.mjs`：覆盖主任务命中、子任务命中、未命中、多选并集与筛选后卡片渲染。
- `plan/m1-01-ui-prototype/review/`：新增修改前后对比与筛选交互截图。
- `plan/fullstack-design/`：补负责人筛选的功能口径、`ownerIds` 查询参数、服务端子任务裁剪与前端交互契约。

## 实施步骤

1. 抽出负责人筛选的纯匹配逻辑并补规格测试。
2. 实现工具栏多选下拉与任务列表联动。
3. 调整示例数据并分别在浏览器中验证两种命中范围及组合筛选。
4. 截取修改前后对比图，补齐流程与 Agent Note。

## 依赖与交付边界

- 依赖：m1 原型定稿与 m1 原型细化。
- 交付边界：只改静态原型、规格测试与截图；不实现 `apps/web` 真实页面与服务端筛选。

## 独立验证

```sh
pnpm test:prototype
pnpm lint:docs
pnpm verify:flow
```

- 规格测试覆盖负责人筛选的两种命中范围与组合条件。
- 浏览器手动验证：多选下拉、主任务负责人命中、仅子任务负责人命中、与重要度及搜索组合、空结果提示。

## 验收标准

- 工具栏负责人下拉可多选成员，选择后任务列表立即更新，清除后恢复全部任务。
- 主任务负责人命中时任务卡保留全部子任务；仅子任务负责人命中时只显示对应子任务且卡片有筛选说明。
- 负责人、重要度与搜索条件同时生效，空结果有明确提示。
- 全栈设计文档中的筛选契约与原型行为一致，并整理一份变更点 Markdown。
- `pnpm test:prototype`、`pnpm lint:docs`、`pnpm verify:flow` 全绿。

## 非目标

- 不修改 `apps/web` 或其他真实实现。
- 不改变任务树计数、情况看板统计与成员视图。
