# 时间段历史查询与双列差异

[English](m5-history-diff.en.md) | 中文

```yaml flow
kind: issue
milestone: m5
priority: P1
status: backlog
scope:
  - apps/server/src/modules/revisions/**
  - apps/server/src/modules/dashboard/**
  - apps/server/src/modules/share/**
  - apps/web/src/features/history/**
  - apps/web/src/features/dashboard/**
  - packages/shared/**
  - tests/history/**
  - .agents/flow/issues/m5-history-diff*
adr: []
github:
  number: null
  url: null
```

## 背景

完整快照只有配合准确的 [start,end) 边界、成员过滤和安全 diff 渲染，才能成为可理解的历史能力。

## 目标

- 实现默认/自定义历史范围、稳定 cursor 与当前相关任务集合计算。
- 按 before/after 快照使用 jsdiff diffLines 返回结构化行差异。
- 实现原型双列 diff、展开状态、currentlyDeleted 徽章和置底展示。

## 设计依据

- `plan/fullstack-design/`：02 §7–8、05 §5.3 与 §6.14、06 §7、07 §4、08 §7–9。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- start 恰好等于变更时不得漏算；空区间、区间内创建/删除不伪造 before/after。
- 成员端先按当前身份裁剪相关任务，再计算变化，不能借历史推断他人任务。
- Vue 按文本渲染 diff，禁止 v-html；限制当前页计算并缓存 revisionId 结果。

## 实施步骤

1. 先写时间边界、创建/删除、空历史、权限和 XSS 测试。
2. 实现查询服务与 DTO，再实现双列组件和展开交互。
3. 验证大文本限制、稳定分页和管理员/成员结果。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行历史边界与 diff 单元测试、成员隔离测试和浏览器走查，覆盖空历史、创建后删除、当前已删除和恶意文本。

## 验收标准

- 所有区间边界和快照选择符合设计，分页结果稳定。
- diff 不执行 HTML/脚本，长文本不会无界阻塞主线程。
- 管理端与成员端只显示各自有权查看的变化，已删除项展示符合原型。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不做自由事件重放、任意版本回滚 UI、HTML diff 注入或跨成员历史检索。
