# Agent Note: 文档工程门禁按独立叶子移植

Status: implemented

[English](2026-11-02-doc-engineering-port.en.md) | 中文

## Problem

ZTask 已有双语三件套、预算、配对和 Agent Note 等基础检查，但移植时把大量门禁测试收在一个手写清单里，新增脚本不会自动进入自测；postmortem、改动面路由、独立 spec 和接线自保护也缺失。继续在单文件里追加测试会让门禁本身难以维护，且 CI 与命令清单脱钩时没有第二道检查。

## Decision

从 StudyWiki 移植通用 docs-as-code 层：每项检查配独立 spec，新增 `verify-postmortem`、`route-gates`、`gate-coverage` 与 `ci-wiring`；`test:gates` 自动扫描 `scripts/` 下的 vitest spec，`run-gates` 再把门禁组合成 doc-quick 与 doc-sync。CI 继续内嵌 `pnpm test`、`pnpm build` 与 `pnpm verify:docs`。

应用专属的环境无关、发布、macOS 打包、插件分层与命令目录门禁不进入 ZTask；`walkthrough` 工程讲解站作为独立子系统暂不移植。

## Alternatives considered

- 整仓复制 StudyWiki 的脚本与内容：会把不存在的产品结构和专属门禁带进来，否决。
- 保留单个 `gates.spec.mjs` 并继续追加用例：新脚本仍可漏测，门禁覆盖本身没有机械背书，否决。
- 同时移植 `walkthrough`：范围远大于文档质量门禁，本轮明确暂缓。

## Consequences

后续新增门禁必须同时提供同名 spec 或登记覆盖关系，并更新 `run-gates`、路由、AGENTS 命令清单和相关文档；否则 `gate-coverage` 或 `ci-wiring` 会红。门禁测试拆成多文件后，单次 vitest 会增加少量启动成本，但局部测试、故障定位和规则演进更清晰。
