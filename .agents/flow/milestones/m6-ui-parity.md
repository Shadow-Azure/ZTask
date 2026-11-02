# 阶段 6：界面与原型逐屏对齐

[English](m6-ui-parity.en.md) | 中文

```yaml flow
kind: milestone
id: m6
title: 阶段 6：界面与原型逐屏对齐
status: active
github:
  number: 7
  url: https://github.com/Shadow-Azure/ZTask/milestone/7
```

以 `plan/m1-01-ui-prototype/ztask-prototype.html` 为唯一界面基准，对管理端与成员端逐屏消除还原差异，并把差异证据与裁决留档。

## 交付边界

- 只做还原对齐与必要的契约、测试同步，不引入原型之外的新功能。
- 视觉与交互逐值对照原型；安全与数据边界不因还原而妥协（如分享链接脱敏形态）。

## 阶段验收

- 逐屏对比不再发现可行动差异，差异为 0 或均登记裁决与理由。
- 单测、构建、文档与 CI 门禁全绿，界面与原型的关键场景可重复验证。
