# 阶段 12：启动占用错误可诊断

[English](m12-startup-occupancy-error.en.md) | 中文

```yaml flow
kind: milestone
id: m12
title: 阶段 12：启动占用错误可诊断
status: active
github:
  number: 12
  url: https://github.com/Shadow-Azure/ZTask/milestone/12
```

同一数据目录已有存活进程时，再次执行 `pnpm serve` 只得到“启动失败：数据目录正被进程 N 持有”，不知道停旧进程、用已运行实例还是清 PID。本阶段让错误给出足够现场与动作。

## 交付边界

- 只改锁冲突错误：`LockHeldError` 携带结构化现场，CLI 按平台渲染动作。
- 锁获取/接管算法、退出码、健康检查与自动停止不变。
- 不新增自动 kill、自动换端口或复用已运行实例。

## 阶段验收

- 存活进程持有时，错误给出 PID、数据目录、管理端地址、平台查看/停止命令与 PID 复用处理。
- 读不到 PID 时，说明原因并给出锁目录与清理前提。
- 单元测试覆盖两类错误与两个平台；CLI 集成测试验证真实输出；README 同步。
