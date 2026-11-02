# 事故复盘（postmortem）

[English](README.en.md) | 中文

事故记录的唯一层级：只有这里允许叙事。一篇一个编号文件 `NNNN-主题.md`，结构固定：

1. **Executive summary** —— 一段话说清影响与结论
2. **Timeline** —— 时间线与证据（引用 commit/日志）
3. **Root cause** —— 根因，指向机制而非个人
4. **Action items** —— 对应到门禁/代码/文档的具体改动

复盘对象不限于线上事故：门禁误放行、流程被绕过、双语配对长期漂移，都值得复盘。

机械校验（verify-postmortem，doc-quick/doc-sync）：编号从 0001 连续不重复；四段标题两侧逐字、顺序固定。

事故件是冻结历史：进库后不修改，后续进展写新文件并互链。写完同 PR 内落地 action items；若引入新门禁，同步登记到 [docs/AGENTS.md](../AGENTS.md) 的门禁清单。
