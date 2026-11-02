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
```

ZTask 以本地 CLI、Web 服务和文件存储提供任务协作。规则见 [README](README.md)，依据为 `plan/fullstack-design/`。

## 交付序列

- m1：原型、全栈设计与研发流程树。
- m2：同源 CLI 服务、可靠文件写协议与 Vue 共享壳。
- m3：任务夹、成员、任务管理与真实事项跟踪。
- m4：LAN 分享、安全会话与负责人最小写入。
- m5：看板、双列 diff、备份恢复与端到端验收。
- m6：界面与原型逐屏对齐与差异清零。

## 推进原则

- 里程碑按序推进，同优先级跨里程碑串行；权限、恢复与版本冲突随所属能力交付。
- 新 issue 从 backlog 开始，经 `pnpm flow:sync` 回填编号后流转；M1 保持真实状态。
