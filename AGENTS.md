# ZTask — Agent 工作约定

本文件是 agent 在本仓库工作的最高层约定。详细规则分层加载：写作规则见 [docs/AGENTS.md](docs/AGENTS.md)，双语配对契约见 [docs/i18n/README.md](docs/i18n/README.md)，Agent Note 体系见 [.agents/notes/README.md](.agents/notes/README.md)，开发流程见 [.agents/flow/README.md](.agents/flow/README.md)。

## 语言

- 常驻文档以中文为 base 侧，英文侧（`.en.md`）随同 PR 同步修改，改后重录 `pnpm record:i18n -- <pair>`。
- 代码、提交信息、PR 标题用英文或中文均可；流程 issue 引用 `(#N)` 写进提交标题。

## 提交前

- 快速档门禁必须绿：`pnpm lint:docs`。
- 涉及文档结构的改动跑全量：`pnpm verify:docs`。
- 门禁失败时修内容或修门禁，不允许绕过（无豁免通道；个别豁免只存在于各 manifest 中并需 PR 说明）。

## 非平凡决策

- 非平凡的实现决策写 Agent Note（路径与格式见 .agents/notes/README.md），放对 lifecycle/class 目录。
- 开发流程尚未初始化：流程树相关内容等待单独规划，不要擅自创建 roadmap/milestone/issue。
