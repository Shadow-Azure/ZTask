# 阶段 16：成员管理员权限

[English](m17-member-admin-permission.en.md) | 中文

```yaml flow
kind: milestone
id: m17
title: 阶段 16：成员管理员权限
status: done
github:
  number: 18
  url: https://github.com/Shadow-Azure/ZTask/milestone/18
```

本阶段交付成员管理员权限：管理员可以在成员管理页把某个成员设为管理员；该成员的分享链接落地管理页，并可在 LAN 上使用同一分享会话调用 Admin API。授权以成员当前 `is_admin` 为准，逐请求校验，撤权、归档或链接轮换/吊销立即生效。

## 交付边界

- 成员记录增加管理员标记，创建/编辑与列表可见；旧库迁移与旧文件导入默认普通成员。
- 管理员成员链接进入管理页；普通成员链接保持成员个人页与只读事项跟踪。
- LAN Admin API 默认拒绝，仅管理员成员会话放行；服务端仍是唯一授权边界。
- 修改同步到设计文档、Agent Note、测试与真实界面，并保留同一场景的修改前后截图。

## 阶段验收

- 管理员可在成员编辑浮窗授予/撤销管理员权限，列表显示状态。
- 管理员成员的分享链接进入管理页并可完成一次管理操作；普通成员与无会话仍被拒绝。
- 撤权、归档、链接重置/吊销后，残留会话立即失去 Admin 访问。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow` 全绿。
