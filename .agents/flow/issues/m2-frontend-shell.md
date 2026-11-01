# Vue 应用壳与原型设计系统迁移

[English](m2-frontend-shell.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P1
status: backlog
scope:
  - apps/web/**
  - packages/shared/**
  - tests/web-shell/**
  - .agents/flow/issues/m2-frontend-shell*
adr: []
github:
  number: 14
  url: https://github.com/Shadow-Azure/ZTask/issues/14
```

## 背景

后续管理端和成员端会共享布局、卡片、弹窗和查询行为，应先迁移设计令牌与壳，避免各页面复制原型 CSS。

## 目标

- 建立 Vue Router、TanStack Query、管理/成员布局及路由访问模式。
- 迁移颜色、间距、字体、任务卡、进度环、弹窗、toast、分栏和响应式规则。
- 封装请求、错误、15 秒轮询与聚焦刷新，私有数据不进入 localStorage。

## 设计依据

- `plan/fullstack-design/`：03 §1–4、§8–9，08 §1–2、§8，原型全部页面。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 定义 admin 与 share 路由占位页，ShareLayout 仅保留成员个人页和事项跟踪。
- 将原型静态结构拆成可复用展示组件，不使用重塑视觉的 UI 套件。
- 为键盘焦点、200% 文本缩放、窄屏和只读模式建立基础测试。

## 实施步骤

1. 先建立原型截图基线与组件清单。
2. 实现设计令牌、壳和请求层，再迁移共享展示组件。
3. 接入路由与查询策略，完成桌面、窄屏和键盘走查。

## 依赖与交付边界

- 前置基线：M1 原型与设计；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行组件测试和生产构建，在 1280/1440 与原型窄屏对照截图；检查路由导航、焦点、轮询暂停和缓存清理。

## 验收标准

- 所有原型路由有明确占位且不会出现无权限业务导航。
- 共享组件与设计令牌可直接被后续任务、看板和成员页复用。
- 空态、错误态、加载态和窄屏无关键内容丢失。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不接真实任务数据，不实现编辑 mutation、分享交换或看板统计。
