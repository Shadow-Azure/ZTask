# Roadmap

[English](roadmap.en.md) | 中文

```yaml flow
kind: roadmap
milestones:
  - m1
  - m2
  - m3
  - m4
  - m5
  - m6
  - m7
  - m8
  - m9
  - m10
  - m11
  - m12
  - m13
  - m14
  - m15
```

ZTask 以本地 CLI、Web 服务和 SQLite 提供协作。规则见 [README](README.md)，依据 `plan/fullstack-design/`。

## 交付序列

- m1：原型、全栈设计与流程树。
- m2：同源 CLI、可靠文件写协议与 Vue 共享壳。
- m3：任务夹、成员、任务管理与事项跟踪。
- m4：LAN 分享、安全会话与负责人最小写入。
- m5：看板、双列 diff、备份恢复与验收。
- m6：界面与原型逐屏对齐与差异清零。
- m7：项目展示图与仓库首页介绍。
- m8：任务管理原型负责人筛选补充。
- m9：小任务保存错误与诊断。
- m10：看板筛选修复。
- m11：任务卡浮窗。
- m12：启动占用错误诊断。
- m13：单包发布与 CI 流水线。
- m14：SQLite 迁移。

## 推进原则

- 里程碑按序推进，同档跨里程碑串行；权限、恢复与版本冲突随能力交付。
- 新 issue 从 backlog 开始，经 `pnpm flow:sync` 回填编号后流转；M1 保持真实。
