# 双语配对契约

[English](README.en.md) | 中文

语料范围：根 `README` 三件套、`docs/`、`.agents/notes/`（archived 除外）、`.agents/flow/` 下的全部 markdown。范围内每个中文 base 文档必须是三件套：`X.md`（中文 base）+ `X.en.md`（英文侧）+ `X.i18n.yaml`（配对记录）。唯一豁免通道是 `scripts/translation-pairing.manifest.json`（如 `docs/AGENTS.md`）；豁免件不得携带英文侧或记录。

## 一致性规则

- 记录：`X.i18n.yaml` 记两侧在最后一次确认一致状态下的 git blob hash；改任一侧而不重录即红。
- 切换行：H1 后第一段是语言切换行，base 侧 `[English](X.en.md) | 中文`，英文侧 `English | [中文](X.md)`。
- 结构镜像：标题层级序列、围栏（info 与内容逐字）、表格行列、列表形态、链接目标两侧一致；散文措辞各自本地化。
- 链接 locale：base 侧指向语料内文档用 `.md`，英文侧用 `.en.md`；切换行是唯一跨语言链接。
- 生成区：`<!-- BEGIN GENERATED slug -->` 围出来的区段两侧除 locale 路径投影外逐字节一致。
- 英文侧术语执行 [terminology.md](terminology.md) 的禁用替写。

## 操作

- 改 base：同步改 `.en.md`（最小修补，保持结构镜像），然后 `pnpm record:i18n -- docs/foo.md`。
- 新建文档：写完两侧后 `pnpm record:i18n -- <pair>` 生成记录；先登记 [docs 索引](../README.md) 与预算 manifest。
- 全库重录：`pnpm record:i18n -- --all`（重录是确认动作，先肉眼过 diff）。
- 状态报告：`node scripts/verify-translation-pairing.mjs --list`。

合并冲突时 `.i18n.yaml` 由 fail-closed 合并驱动处理（`pnpm install-merge-driver` 注册）：两侧各自重录过则留在冲突态，人工合并 md 两侧后重录。
