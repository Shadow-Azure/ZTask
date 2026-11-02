# 阶段 4：分享与成员协作

[English](m4-sharing-collaboration.en.md) | 中文

```yaml flow
kind: milestone
id: m4
title: 阶段 4：分享与成员协作
status: done
github:
  number: 4
  url: https://github.com/Shadow-Azure/ZTask/milestone/4
```

实现受控的局域网只读分享、成员身份会话和最小成员写入能力，同时确保管理端永不暴露到 LAN。

## 交付边界

- 只交付本阶段 issue 声明的能力，后续阶段功能不以隐藏实现提前混入。
- 所有实现遵循 `plan/fullstack-design/` 与定稿原型；非平凡决策登记 Agent Note。

## 阶段验收

- 动态 LAN 监听、分享地址、生成/轮换/吊销链接和旧会话失效行为一致。
- 成员只能访问与自身相关的数据；负责人和协作者权限在 API 与 UI 双侧生效。
- 成员个人页可更新负责任务的进度、详情和小任务，事项跟踪始终只读。
