# ZTask

[English](README.en.md) | 中文

ZTask 是一个管理团队进度的工具（Team progress management tool）。项目处于初始阶段：愿景与边界见 [charter](docs/charter.md)，当前工程重心是文档体系与开发流程门禁，产品功能规划后续再定。

## 工程约定与门禁

- 常驻文档双语成对（三件套：`X.md` + `X.en.md` + `X.i18n.yaml`），契约见 [docs/i18n/README.md](docs/i18n/README.md)。
- 开发流程（roadmap → milestone → issue）规则见 [.agents/flow/README.md](.agents/flow/README.md)，当前尚未初始化。
- 文档门禁：`pnpm verify:docs`（全量）/ `pnpm lint:docs`（快速档）。
- 流程门禁：`pnpm verify:flow`（流程树未初始化时自动跳过）。
- 门禁自测试：`pnpm test:gates`。

首次 clone 后执行 `pnpm install && pnpm install:hooks` 安装本地钩子与 i18n 合并驱动。
