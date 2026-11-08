# 新增 ztask init 配置 PATH

[English](m13-ztask-init-path.en.md) | 中文

```yaml flow
kind: issue
milestone: m13
priority: P0
status: in-progress
scope:
  - apps/cli/**
  - tests/**
  - README.md
  - README.en.md
  - README.i18n.yaml
  - apps/ztask/README.md
  - scripts/doc-budgets.manifest.json
  - .agents/flow/issues/m13-ztask-init-path*
  - .agents/notes/**
adr:
  - ../../notes/implemented/feature/2026-11-07-ztask-init-path.md
github:
  number: 86
  url: https://github.com/Shadow-Azure/ZTask/issues/86
```

## 背景

`npm install -g` 后，如果 npm 的全局可执行目录不在 PATH，`ztask serve` 会提示找不到命令。用户要求提供一个一次性的 `npx ztask init`：把该目录写入 shell 启动配置，之后可直接运行 `ztask serve`；README 同时说明找不到命令时可用 `npx ztask serve` 或先执行 `npx ztask init`。

## 目标

- 新增引导式 `ztask init` 子命令：解析 npm 全局前缀，计算可执行目录；已配置时只提醒，否则展示目录并询问 y/n，确认后写入 shell 启动文件（Windows 写当前用户 PATH）；`--yes` 跳过确认。
- 输出目录、写入位置、当前终端生效命令与 ztask shim 缺失提示；用户拒绝时退出码 0，读取/确认/写入失败以非零退出码结束。
- 根 README 中英双侧与包 README 补充找不到命令时的两种启动路径。
- 用临时主目录与注入前缀/确认函数覆盖幂等、确认与拒绝、文件选择、平台分支；写 Agent Note 记录持久化 PATH 的取舍。

## 验收

- `ztask init` 在 PATH 未包含 npm 全局目录时展示目录并等待确认：输入 y 后写入 zsh/bash/fish 对应启动文件，重复执行不重复追加；输入 n 时不修改；已配置时只提醒。
- `--yes` 跳过确认；非交互环境未加 `--yes` 时以退出码 1 结束并提示。
- Windows 分支更新当前用户 PATH 而不触碰系统 PATH；用户拒绝时不写入。
- README 中英双侧说明 `npx ztask init` 的确认流程与 `--yes`。
- `pnpm build`、`pnpm test`、`pnpm lint:docs`、`pnpm verify:docs`、`pnpm verify:flow` 通过。
