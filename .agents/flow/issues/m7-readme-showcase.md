# 完善 README 展示图与项目介绍

[English](m7-readme-showcase.en.md) | 中文

```yaml flow
kind: issue
milestone: m7
priority: P1
status: done
scope:
  - README*
  - docs/assets/ztask-admin.png
  - scripts/doc-budgets.manifest.json
  - .agents/flow/roadmap*
  - .agents/flow/milestones/m7-project-portal*
  - .agents/flow/issues/m7-readme-showcase*
adr: []
github:
  number: 53
  url: https://github.com/Shadow-Azure/ZTask/issues/53
```

## 背景

README 目前只有简短说明与命令清单，新访客看不到产品形态，也不清楚它解决什么问题。需要补充一张真实管理端截图与面向新访客的能力介绍。

## 目标

- 在 README 顶部加入真实管理端截图与一句话价值主张。
- 补充主要能力、快速开始和文档入口，同时控制首页长度。
- 同步英文侧与双语配对记录，截图只使用虚构示例数据。

## 独立验证

```sh
pnpm lint:docs && pnpm verify:docs && pnpm verify:flow
```

## 非目标

- 不修改产品代码、页面样式或功能行为。
- 不新增外部服务依赖。
