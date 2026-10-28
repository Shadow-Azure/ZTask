# 指标口径（待规划）

[English](metrics.en.md) | 中文

ZTask 尚无产品，本文件先占住指标工程的位置：任何要长期跟踪的数字，先在这里登记口径，再去做采集。

## 已定的口径

- 文档词数预算：计数规则见 `scripts/verify-doc-budgets.mjs`（CJK 按字、其余按空白分词，生成区不计），登记表在 `scripts/doc-budgets.manifest.json`。
- 门禁豁免率：`ts` 围栏豁免（`ignore-check`）超过半数即红，见 `scripts/doc-typecheck.mjs`。

## 待规划的口径

产品上线后按第一批能力补充：进度更新的及时性、状态一致性、协作参与度。口径登记进本文件前不实现采集。
