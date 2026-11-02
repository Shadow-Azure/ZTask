# AGENTS.md — 文档标准

本文件定义 `docs/` 的层级、写作规则和门禁。改规则须同 PR 改脚本、文档与测试。

## 层级：一个事实一个 home

| 层 | 职责 | 不放在这里 |
|---|---|---|
| 根 `AGENTS.md` | 常驻指令与命令清单 | 故事、示例、本页规则的复述 |
| `docs/architecture.md` | 当前仓库组成与数据流 | 决策理由（→ Agent Note）、逐 API 细节 |
| `docs/development.md` | 贡献者上手与常用门禁 | 会漂移的完整脚本清单（→ `package.json`） |
| `docs/i18n/README.md` | 双语三件套、镜像与豁免契约 | 翻译教程 |
| `docs/postmortem/` | 事故复盘，全库唯一允许叙事的层级 | 常驻规则 |
| `.agents/notes/` | 非平凡决策：为什么、放弃了什么 | 现状描述（→ docs） |
| `.agents/flow/` | roadmap、milestone、issue 与流程契约 | 决策理由（→ Agent Note） |
| 代码内文档 | 契约语义：何时触发、边界、失败处置 | 推理过程、代码复述 |

放置口诀：事故 → postmortem；理由 → Agent Note；步骤 → development；现状 → 常驻文档；跨仓库规则 → 根 AGENTS。

## 写作规则

- 写现状，不写变更史：历史和动机进 commit、Agent Note 或 postmortem。
- 段落一行到底：不手动折行，列表项与引用内段落同理；表格、标题、围栏和 HTML 注释除外（`verify-md-wrap`）。
- 链接指向语料内文档时写仓库相对路径；死链与死锚由 `verify-md-links` 把关。
- 文档里的 `ts` 围栏会被真实编译；`ts ignore-check` 是显式豁免，豁免率超半即红（`doc-typecheck`）。
- `ts type-equiv` 围栏声明与源码结构及 JSDoc 等价，围栏和 manifest 必须 1:1（`verify-type-equiv`）。
- `apps/`、`packages/` 的 TS 导出须有 JSDoc；函数形参和非 void 返回须补齐标签（`verify-export-docs`）。
- 每个非平凡变更在同一 PR 新增或更新至少一条 Agent Note。

## 双语与索引

- 语料内每个中文 base 文档必须有同目录 `.en.md` 和 `.i18n.yaml` 三件套；改任一侧后最小修补另一侧并执行 `pnpm record:i18n -- <pair>`，契约见 [i18n/README.md](i18n/README.md)。
- 根 `README`、`docs/**`、`.agents/notes/**`（archived 除外）和 `.agents/flow/**` 属于配对语料。唯一豁免登记处是 `scripts/translation-pairing.manifest.json`。
- [README.md](README.md) 的地图表是 docs 唯一索引：每个常驻文档必须登记，登记的必须存在（`verify-doc-index`）。
- 每份常驻文档在 `scripts/doc-budgets.manifest.json` 登记词数上限；超限依次搬层、压缩、提预算，提预算须在 PR 说明。
- postmortem 事故件是冻结历史，不进索引、不计数。

## 门禁

```sh
pnpm lint:docs    # doc-quick：结构、索引、预算、配对、类型等价、导出注释和源码引用
pnpm verify:docs  # doc-sync：上述检查 + 死链 + ts 围栏编译 + 门禁自测试
pnpm route:gates  # 按工作树改动面推荐该跑的组合
pnpm test:gates   # 全部门禁与流程脚本自测
```

叶子与模式组合的唯一 home 是 [scripts/run-gates.mjs](../scripts/run-gates.mjs)。CI 静态 lane 内嵌 `pnpm test`、`pnpm build` 与 `pnpm verify:docs`，没有绕过文档门禁的接线。
