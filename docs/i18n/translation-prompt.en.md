# Translation prompt

English | [中文](translation-prompt.md)

When translating a base document into its English side, feed the template below together with the terminology table to the translator (human or model). The translation must keep the structure mirrored: heading levels, fences verbatim, table shape, list shape and link targets unchanged; only prose and table headers are translated, and links to corpus documents point to the `.en.md` side.

Template:

```text
Translate the document {{source_document}} into English.
Base name: {{source_basename}}
Apply the terminology table verbatim; never use the banned alternatives:
{{terminology}}
Keep the Markdown structure mirrored exactly (headings, fences, tables, lists,
link targets). Links to corpus documents point to the .en.md side.
```

The placeholder set inside the template fence is pinned by a gate: each known placeholder exactly once, any unknown placeholder turns red.
