# 分聚合文件存储与写协议

[English](m2-file-storage.en.md) | 中文

```yaml flow
kind: issue
milestone: m2
priority: P0
status: in-progress
scope:
  - apps/server/src/storage/**
  - apps/server/src/plugins/**
  - apps/server/src/bootstrap.ts
  - apps/server/src/index.ts
  - packages/shared/**
  - tests/storage/**
  - .agents/flow/issues/m2-file-storage*
adr: []
github:
  number: 13
  url: https://github.com/Shadow-Azure/ZTask/issues/13
```

## 背景

任务与历史的一致性依赖文件协议，若等业务代码各自读写 JSON，将产生半文件、版本错配和无法恢复的历史。

## 目标

- 实现 manifest、分聚合 current.json、revisions.jsonl、索引和会话文件的统一存储接口。
- 提供进程内串行写队列、数据目录锁、乐观 version 复查与原子 JSON 发布。
- 实现 JSONL checksum、半行尾部恢复、current/revisionTip 校验和索引重建。

## 设计依据

- `plan/fullstack-design/`：01 §6–7、04 §5–6、06 全文、07 §2。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 所有 JSON 写采用同目录临时文件、fsync、rename；任务有效变更先追加完整 revision 再发布 current。
- 存储层对业务暴露事务式聚合写入，不允许路由直接操作文件路径。
- 故障注入覆盖 append、current 发布和索引更新，损坏中间历史必须显式报错。

## 实施步骤

1. 用临时目录编写原子写、锁、版本和恢复规格测试。
2. 实现文件原语与目录初始化，再实现聚合事务和 revision 服务。
3. 加入索引重建与故障注入测试，验证重启后的可读状态。

## 依赖与交付边界

- 前置基线：M1 原型与设计；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行存储单元与故障注入测试，反复中止写入进程；重建索引后比较 current、revisionTip 和引用关系。

## 验收标准

- 任何注入失败后都不会把部分 JSON 当作有效当前状态。
- 并发写只有一个成功，另一个获得 version 冲突且历史不重复。
- 合法半行尾部可恢复，中间 checksum 损坏不会被静默丢弃。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不实现业务路由、在线备份 UI 或跨设备同步；不引入 SQLite。
