# 阶段 15：成员链接全团队可见与负责人写边界

[English](m15-member-visibility.en.md) | 中文

```yaml flow
kind: milestone
id: m15
title: 阶段 15：成员链接全团队可见与负责人写边界
status: done
github:
  number: 17
  url: https://github.com/Shadow-Azure/ZTask/milestone/17
```

成员链接从“只看与自己相关的任务”改为“可查看团队全部任务，只有主任务负责人可写自己负责的进度、详情和小任务”。阶段内同步调整后端读范围、成员个人页三组分组与折叠、只读事项跟踪/看板/历史，以及文档与测试。

## 交付边界

- 仅改变成员读范围与个人页分组/折叠；不改变管理员能力、存储结构或分享链接生命周期。
- 写权限仍只给主任务 owner；collaborator、仅小任务被分配者和其他成员只读。
- 事项跟踪保持完全只读；负责人编辑入口只在成员个人页。
- 不做逐任务私密开关、账号体系或跨设备折叠状态持久化。

## 阶段验收

- 成员个人页三组（负责/协作/其他成员）不重不漏，默认展开且标题可折叠；其他成员卡只读。
- 成员事项跟踪、任务夹树、看板与历史覆盖团队全部任务；即使自己的任务也只读。
- 管理员 API、写队列、version 冲突和分享会话语义不变。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow` 全绿。
