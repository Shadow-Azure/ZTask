# 成员页保存改为单卡保存与自动保存

[English](m16-member-autosave.en.md) | 中文

```yaml flow
kind: issue
milestone: m16
priority: P2
status: done
scope:
  - apps/web/**
  - tests/**
  - plan/**
  - .agents/**
  - reports/**
  - scripts/**
adr:
  - ../../notes/implemented/feature/2026-11-08-member-auto-save.md
github:
  number: 95
  url: https://github.com/Shadow-Azure/ZTask/issues/95
```

## 背景

2026-11-08 用户反馈：成员个人页只改进度详情时，被「保存进度」「保存详情」两个按钮卡住，无法判断应该点哪一个；确认把保存交互改为单卡「保存」+ 停顿自动保存 + 页面 Ctrl+S。原型与修改前/后截图已由用户确认。

## 目标

- 每张 owner 任务卡只保留一个「保存」，一次提交本任务进度与完整详情；两个端点仍独立，按 progress → detail 串行提交，detail 使用 progress 响应后的新 version。
- 编辑停顿 2 秒自动保存；成员首页 Ctrl/⌘+S 保存整页所有任务卡；底部内联显示保存状态与时间。
- 保留 409 草稿保留与刷新提示，小任务自己的保存按钮不变；兼容成员视图“团队全部任务 + 负责人可编辑”的可见性边界。
- 设计文档与 Agent Note 同步；原型由并发 UI PR 持续迭代。

## 验收

- 只改进度、只改详情、进度+详情同时改都成功；detail 请求携带正确 version。
- 自动保存与 Ctrl+S 整页保存有自动化看护与真实分享页冒烟证据。
- 修改前/后截图进入 PR 描述，协作与其他成员卡保持只读。
