# 阶段 5：看板历史与交付加固

[English](m5-insights-recovery-release.en.md) | 中文

```yaml flow
kind: milestone
id: m5
title: 阶段 5：看板历史与交付加固
status: planned
github:
  number: 5
  url: https://github.com/Shadow-Azure/ZTask/milestone/5
```

完成看板统计与历史差异闭环，并用故障恢复、备份、权限隔离和端到端验收证明首版可交付。

## 交付边界

- 只交付本阶段 issue 声明的能力，后续阶段功能不以隐藏实现提前混入。
- 所有实现遵循 `plan/fullstack-design/` 与定稿原型；非平凡决策登记 Agent Note。

## 阶段验收

- 管理员和成员看板在各自数据范围内得到一致的统计、分布和变更结果。
- 历史区间按 [start,end) 还原 before/after，双列 diff 与已删除任务展示符合原型。
- 崩溃恢复、在线备份、权限隔离、桌面/窄屏和并发主链路均有可重复验证。
