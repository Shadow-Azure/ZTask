# 翻译提示词

[English](translation-prompt.en.md) | 中文

把 base 侧文档翻译成英文侧时，把下面的模板连同术语表喂给翻译者（人或模型）。译文必须保持结构镜像：标题层级、围栏逐字、表格行列、列表形态、链接目标不变，只译散文与表头；指向语料内文档的链接改指 `.en.md`。

模板：

```text
Translate the document {{source_document}} into English.
Base name: {{source_basename}}
Apply the terminology table verbatim; never use the banned alternatives:
{{terminology}}
Keep the Markdown structure mirrored exactly (headings, fences, tables, lists,
link targets). Links to corpus documents point to the .en.md side.
```

模板围栏里的占位符集合受门禁钉住：已知占位符各恰好一次，未知占位符即红。
