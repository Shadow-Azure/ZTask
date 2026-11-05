# 把“数据目录被占用”的启动错误说明清楚

[English](m12-data-dir-lock-message.en.md) | 中文

```yaml flow
kind: issue
milestone: m12
priority: P2
status: done
scope:
  - apps/server/**
  - apps/cli/**
  - tests/**
  - .agents/**
  - scripts/doc-budgets.manifest.json
adr:
  - ../../notes/implemented/bug-fix/2026-11-04-startup-lock-error-diagnostics.md
github:
  number: 73
  url: https://github.com/Shadow-Azure/ZTask/issues/73
```

## 背景

用户第二次启动 ZTask 时得到 `启动失败：数据目录正被进程 62817 持有`。这条消息只说“被谁持有”，没有数据目录、没有已在运行实例的地址，也没有说明应该停掉旧进程、直接访问旧实例，还是清理被复用的 PID；用户无法从错误本身判断下一步。

`acquireDataDirLock()` 已经知道锁目录和持有者 PID，但 `LockHeldError` 只携带一行消息，CLI 又缺少启动上下文，所以只能原样打印。读不到 PID 的锁目录与活进程持有共用同一条错误路径，现场信息同样不足。

## 目标

- `LockHeldError` 携带数据目录、锁目录与持有者 PID，调用方不需要再解析消息文本。
- `ztask serve` 在锁冲突时输出多行、可操作的错误：数据目录、已知管理端地址、平台对应的查看/停止命令，以及 PID 复用时的清理前提。
- 读不到 PID 时给出独立说明：可能原因、锁目录位置、确认没有写者后才能删除。
- 用单元测试固定两种错误与两个平台的文案，用 CLI 集成测试固定真实启动输出；同步 CLI README。

## 验收

- 数据目录被存活进程持有时，stderr 含 PID、数据目录、`http://host:port/`（端口已知时）、POSIX 或 Windows 对应的查看/停止命令，以及“进程不是 ZTask 时删除锁目录”的说明。
- 端口为 `0` 或读不到 PID 时，错误不伪造地址，并给出正确的下一步。
- `LockHeldError` 的 `dataDir`、`lockDir`、`pid` 在第二个实例被拒的测试中可直接断言。
- 新增 CLI 集成测试：真实子进程启动、锁被测试进程持有、退出码为 1，且 stderr 覆盖上述关键信息。
- `pnpm test`、`pnpm lint:docs`、`pnpm verify:flow` 通过；不改变锁算法与退出码。
