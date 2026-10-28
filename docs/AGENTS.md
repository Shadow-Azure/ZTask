# docs 写作规则

本目录是 ZTask 的常驻文档。规则是机械门禁（scripts/）的语义来源，门禁是规则的机械执行；改规则须两侧同步。

## 语体与结构

- 每个散文段落一行到底：不手动折行，列表项与引用内段落同理。表格、标题、围栏、HTML 注释除外。
- 标题只用 `#`～`##` 起头组织；段落里避免堆叠加粗当标题用。
- 代码示例一律走围栏（不用缩进代码块）；文档里的 `ts` 围栏会被真实编译（`doc-typecheck`），编译不过即红。`ts ignore-check` 是显式豁免，豁免率超半即红。
- 链接指向语料内文档时写仓库相对路径；死链与死锚由 `verify-md-links` 把关。

## 双语三件套

- 语料内每个中文 base 文档（`X.md`）必须有同目录 `X.en.md` 与 `X.i18n.yaml`，契约见 [i18n/README.md](i18n/README.md)。
- 两侧结构镜像：标题层级、围栏（逐字）、表格、列表、链接目标一致；散文可各自本地化。
- 改任一侧后带上另一侧，然后 `pnpm record:i18n -- <pair>` 重录。
- 豁免配对的文件（如本文件）在 scripts/translation-pairing.manifest.json 里登记，豁免件不得携带 `.en.md`/`.i18n.yaml`。

## 索引与预算

- [README.md](README.md) 的地图表是 docs 唯一索引：每个语料文档必须登记，登记的必须存在（`verify-doc-index`）。
- 每份常驻文档在 scripts/doc-budgets.manifest.json 登记词数上限；超限处置顺序：搬层 → 压缩 → 提预算（PR 说明理由）。
- postmortem 事故件（`docs/postmortem/` 下的 `yyyy-mm-dd-*.md`）是冻结历史，不进索引、不计数。

## 术语

- 中英对照以 [i18n/terminology.md](i18n/terminology.md) 为唯一词表；英文侧散文出现词表的「禁用替写」即红（`verify-terminology`）。
- 新术语先进词表，再进正文。
