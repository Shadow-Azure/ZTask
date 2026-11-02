# 文档索引与维护机制

[English](README.en.md) | 中文

ZTask 把文档当作与代码同级的工件：每条需要保持一致的要求尽量由机械门禁执行，人只判断取舍、翻译和归档。语料内文档保持中英三件套。

## 文档地图

| 文档 | 职责 |
|---|---|
| [AGENTS.md](AGENTS.md) | docs 写作规则与门禁摘要（单语豁免件） |
| [charter.md](charter.md) | 愿景与边界 |
| [architecture.md](architecture.md) | 当前仓库组成、技术边界与文档工程 |
| [development.md](development.md) | 环境、开发循环、钩子与 CI |
| [metrics.md](metrics.md) | 指标口径 |
| [review.md](review.md) | 评审与验收规则 |
| [postmortem/README.md](postmortem/README.md) | 事故复盘契约 |
| [i18n/README.md](i18n/README.md) | 双语配对契约 |
| [i18n/terminology.md](i18n/terminology.md) | 术语表与禁用替写 |
| [i18n/translation-prompt.md](i18n/translation-prompt.md) | 补英文侧的操作模板 |

流程树在 [.agents/flow/README.md](../.agents/flow/README.md)，决策记录在 [.agents/notes/README.md](../.agents/notes/README.md)。

## 机械面

- 索引、词数预算、段落换行、postmortem 结构和 Agent Note 状态由独立门禁检查。
- 双语记录保存两侧 blob hash，同时校验切换行、链接 locale、围栏与结构镜像。
- 死链和死锚、ts 围栏编译、type-equiv 声明、TS 导出 JSDoc 与源码文档引用各有独立叶子。
- `route:gates` 按改动路径推荐组合；`test:gates` 自动运行 `scripts/` 下全部门禁 spec。

## 维护循环

规则注入 → 决策落档 → 现状文档 → 双语配对 → 本地快速门禁 → CI 全量裁决 → 事故复盘。`pnpm lint:docs` 是提交前快速档，`pnpm verify:docs` 是 CI 使用的全量档。
