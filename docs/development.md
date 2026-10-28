# 开发上手

[English](development.en.md) | 中文

## 环境

- Node 22 + pnpm（`packageManager` 字段锁定版本）。`pnpm install` 后执行 `pnpm install:hooks` 安装 git 钩子与 `.i18n.yaml` 合并驱动。
- 无数据库、无外部服务；本地门禁全部离线可跑。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `pnpm lint:docs` | 快速档文档门禁（秒级，提交前随手跑） |
| `pnpm verify:docs` | 全量文档门禁（含死链、ts 围栏编译、门禁自测试） |
| `pnpm verify:flow` | 开发流程门禁（流程树未初始化时自动跳过） |
| `pnpm test:gates` | 门禁自测试 |
| `pnpm record:i18n -- <pair>` | 改完双语两侧后重录配对记录 |

## 分支与提交

- 分支名 `feat/`、`fix/`、`docs/` 前缀加短横线主题。
- 提交标题用语义化前缀（`docs:`、`chore(gates):`、`ci:` 等）；流程树初始化后标题须挂 issue 引用 `(#N)`，现在只有本地提醒不拦截。
- push 前钩子自动跑快速档；穷尽覆盖归 CI。

## CI

- 静态 lane：`pnpm test:gates`、`pnpm verify:docs`、PR 时 `node scripts/verify-flow.mjs --diff origin/<base>`（base 无流程树则跳过）。
- 在线 lane（PR）：`verify-flow-online.mjs` 校验流程树与 GitHub 双侧一致，需要 `GH_TOKEN`。
