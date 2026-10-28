# Agent Note 体系

[English](README.en.md) | 中文

Agent Note 是非平凡实现决策的一页记录：谁在未来翻到这段代码，都能知道「当时为什么这么定、否掉了什么」。规则是封闭集合，与 `scripts/verify-agent-notes.mjs` 互为镜像。

## 路径状态机

路径必须是 `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-主题.md`，三段缺一不可。

- lifecycle（封闭集合）：`proposed` / `implemented` / `rejected` / `archived`。状态流转就是移动目录：`proposed` 被接受进 `implemented`，被否进 `rejected`（Status 须带一行理由），过期进 `archived`。
- class（封闭集合）：`feature` / `bug-fix` / `simplification` / `architecture` / `process` / `testing`。
- 归档走 `pnpm archive:note`：移动 + Status 改写 + 记 sha256 进 `archived/manifest.json`（append-only，冻结件不可再改，由 `verify-archived-agent-notes` 管辖）。

## 文件格式

- 第一行：`# Agent Note: <标题>`；第三行：`Status: <lifecycle>`（rejected 例外，写 `rejected — <理由>`）。
- 正文骨架四段逐字按序：`## Problem`、`## Decision`、`## Alternatives considered`、`## Consequences`。自由段只许插在骨架段之间；`Consequences` 之后不许再放二级标题。
- 双语：note 同样是三件套，遵守 docs/i18n 契约；骨架段名两侧各自钉住。
- 互引链接必须可达、锚点必须存在（门禁直查）。

## 与流程的关系

流程树未初始化阶段照常写 note；流程初始化后，issue 的设计依据章节引用相关 note。
