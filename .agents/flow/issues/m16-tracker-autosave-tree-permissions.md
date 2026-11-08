# 事项跟踪原型自动保存与管理员右键菜单

[English](m16-tracker-autosave-tree-permissions.en.md) | 中文

```yaml flow
kind: issue
milestone: m16
priority: P2
status: done
scope:
  - plan/m1-01-ui-prototype/**
  - scripts/prototype-tracker.spec.mjs
  - .agents/flow/issues/m16-*
  - .agents/notes/proposed/feature/2026-11-08-tracker-autosave-context-menu*
  - apps/web/src/features/folders/**
  - apps/web/src/features/tracker/**
  - tests/admin-members/**
  - tests/tracker/**
adr:
  - ../../notes/proposed/feature/2026-11-08-tracker-autosave-context-menu.md
github:
  number: 91
  url: https://github.com/Shadow-Azure/ZTask/issues/91
```

## 背景

当前原型只有手动保存，左侧任务树没有管理操作入口，无法先确认“全局定时检测并自动保存”和“管理员右键新建/删除任务”的产品形态。

## 目标

- 在事项跟踪原型加入全局自动保存状态：显示每 5 秒检测、检测到变更、自动保存完成。
- 将任务浮窗、成员编辑和成员视图进度接入自动保存；新建任务/成员保留明确创建动作。
- 自动保存默认开启，可通过 `~/.ztask/settings.json` 的 `autosave.enabled=false` 或 `ztask autosave off` 关闭；关闭后恢复手动保存。
- 管理员左树右键任务夹可新建任务，右键任务可新建或删除任务；成员个人页增加团队全部任务的只读文件树并支持右键，管理员专属项置灰，权限标签放到对应选项行；卡片保持负责/协作/其他成员三组且标题可折叠。
- 保留修改前后截图供确认。

## 实现内容

- `plan/m1-01-ui-prototype/ztask-prototype.html`：顶部自动保存状态与设置浮层、任务/成员浮窗自动保存和手动模式、成员视图进度自动保存、管理员左树和成员个人页左树右键菜单，以及成员三组卡片与折叠。
- `apps/web` 的 `FolderTree` / `FolderTreeNode` / `TrackerView`：管理员和成员事项跟踪树都支持右键；管理员操作可用，成员端管理员专属项置灰并逐行标注「仅管理员」；新建任务、新建子任务夹、删除任务沿用现有编辑器与确认弹窗。
- `tests/admin-members`、`tests/tracker`：覆盖树节点右键事件、管理员可用菜单和成员置灰菜单。
- `scripts/prototype-tracker.spec.mjs`：覆盖自动保存状态文案与关闭态、任务草稿校验、成员树过滤、选项级权限和菜单定位。
- `plan/m1-01-ui-prototype/review/`：保存权限标签、成员树、自动保存配置的修改前后截图。
- 本次只调整静态原型；真实前端、`~/.ztask/settings.json` 读写和 `ztask` 命令待原型确认后另行安排。

## 独立验证

```sh
pnpm test:prototype
pnpm lint:docs
pnpm verify:docs
pnpm verify:flow
```

- 规格测试覆盖自动保存状态、草稿校验、管理员/成员菜单差异和菜单边缘定位。
- 浏览器验证右键任务夹/任务、自动保存检测与完成状态、成员视图无任务树。

## 非目标

- 不实现真实 `apps/web`、`~/.ztask/settings.json` 读写、`ztask` 命令或服务端自动保存。
- 不改变任务数据协议、成员权限矩阵或成员视图的可见范围。
