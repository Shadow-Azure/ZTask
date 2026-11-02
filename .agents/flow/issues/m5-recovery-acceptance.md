# 备份恢复、故障注入与首版端到端验收

[English](m5-recovery-acceptance.en.md) | 中文

```yaml flow
kind: issue
milestone: m5
priority: P0
status: in-progress
scope:
  - apps/cli/**
  - apps/server/src/modules/maintenance/**
  - apps/server/src/storage/**
  - docs/**
  - tests/e2e/**
  - tests/recovery/**
  - tests/storage/**
  - .agents/notes/implemented/feature/2026-11-02-*
  - packages/shared/**
  - plan/fullstack-design/05-api-design.md
  - apps/server/src/index.ts
  - apps/server/src/app.ts
  - package.json
  - .agents/flow/issues/m5-recovery-acceptance*
adr: []
github:
  number: 23
  url: https://github.com/Shadow-Azure/ZTask/issues/23
```

## 背景

首版交付前需证明文件协议在真实故障和完整主链路下可恢复，并把启动、备份与权限边界沉淀成可操作文档。

## 目标

- 实现暂停写队列的在线备份与新目录恢复校验。
- 完成启动、分享、管理、成员协作、看板历史和并发冲突的端到端测试。
- 补齐故障注入、备份恢复、权限隔离、桌面/窄屏与可访问性验收文档。

## 设计依据

- `plan/fullstack-design/`：01 §6–10、04 §9–10、06 §8–10、09 §3 与 §6。
- `plan/m1-01-ui-prototype/ztask-prototype.html` 是界面与交互基准。

## 实现内容

- 备份等待在途写入，在临时目录校验 manifest、JSON/JSONL、checksum 与引用后发布。
- 提供可重复的种子数据与故障点，不在测试中使用真实私密数据目录。
- 更新常驻架构/开发文档和 Agent Note，确保实际实现不偏离已确认边界。

## 实施步骤

1. 先实现备份/恢复规格测试和完整验收矩阵。
2. 补故障注入与端到端自动化，修复发现的问题。
3. 执行干净目录恢复和双成员浏览器验收，最后同步文档。

## 依赖与交付边界

- 前置基线：roadmap 中此前的里程碑；本 issue 只交付上述范围，其他能力由后续 issue 承担。
- 代码改动限制在 scope；跨 issue 的接口先在 `packages/shared` 明确契约，不复制私有实现。

## 独立验证

```sh
pnpm test && pnpm lint:docs && pnpm verify:flow
```

运行全部单元、集成、故障注入与端到端门禁；从在线备份在新数据目录启动，重跑 A/B 权限和主链路。

## 验收标准

- 备份不包含混合时间点状态，恢复后数据、历史、会话策略与索引一致。
- 09 §6 十类验收场景均有结果，严重权限/数据丢失问题为零。
- 新用户可按文档启动、备份和恢复，全部 CI 与文档门禁通过。

## 门禁与 CI

- 提交与 PR 标题引用本 issue 的 GitHub `(#N)`；开工前完成 `pnpm flow:sync` 并流转 ready。
- 必过 `pnpm test`、`pnpm lint:docs`、涉及文档结构时的 `pnpm verify:docs` 与 `pnpm verify:flow`；CI 另跑 PR diff scope 和 GitHub 双侧一致性。
- 新权限、存储或架构决策须登记 proposed Agent Note，完成实现后按规范归档。

## 非目标

- 不承诺公网高可用、多写者、多设备同步、插件系统或首版明确排除的功能。
