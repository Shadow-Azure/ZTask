# 阶段 11：任务卡内容区打开浮窗

[English](m11-task-card-pane-modal.en.md) | 中文

```yaml flow
kind: milestone
id: m11
title: 阶段 11：任务卡内容区打开浮窗
status: active
github:
  number: 11
  url: https://github.com/Shadow-Azure/ZTask/milestone/11
```

用户反馈任务管理页点击「子任务进展」「进展详情」不出现浮窗；当前只有卡头可打开。本阶段把内容区补成同等打开入口，并补回归与冒烟证据。

## 交付边界

- 只改任务卡内容区的点击 / 键盘入口、提示文案、原型与回归测试。
- 浮窗内容、数据协议、权限与内容区只读展示不变。
- 分隔条拖拽与文字选择不变：拖柄、拖选都不触发浮窗。

## 阶段验收

- 管理端点任一区块打开编辑浮窗；成员只读视图打开只读详情浮窗。
- 键盘 Enter/Space 等价，且不新增编辑控件。
- 回归用例修复前失败、修复后通过；真实构建冒烟覆盖前后对照。
