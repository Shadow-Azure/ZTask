# 指标口径

[English](metrics.en.md) | 中文

ZTask 处于可运行基座向任务工作流推进的阶段：任何要长期跟踪的数字，先在本文登记口径，再实现采集。

## 已定的口径

- 文档词数预算：计数规则见 `scripts/verify-doc-budgets.mjs`（CJK 按字、其余按空白分词，生成区不计），登记表在 `scripts/doc-budgets.manifest.json`。
- 门禁豁免率：`ts` 围栏豁免（`ignore-check`）超过半数即红，见 `scripts/doc-typecheck.mjs`。

## 待规划的口径

任务工作流稳定后补充：进度更新的及时性、状态一致性、协作参与度。口径登记进本文件前不实现采集。
