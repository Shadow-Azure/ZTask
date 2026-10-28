# Bilingual pairing contract

English | [中文](README.md)

Corpus scope: the root `README` triplet, `docs/`, `.agents/notes/` (except archived) and every markdown under `.agents/flow/`. Every Chinese base document inside the corpus must be a triplet: `X.md` (Chinese base) + `X.en.md` (English side) + `X.i18n.yaml` (pairing record). The only exemption channel is `scripts/translation-pairing.manifest.json` (e.g. `docs/AGENTS.md`); an exempted file must not carry an English side or a record.

## Consistency rules

- Record: `X.i18n.yaml` stores both sides' git blob hash at the last confirmed consistent state; editing either side without re-recording turns the pair red.
- Switcher: the first line after H1 is the language switcher — `[English](X.en.md) | 中文` on the base side, `English | [中文](X.md)` on the English side.
- Structure mirror: heading levels, fences (info string and content verbatim), table shape, list shape and link targets match on both sides; prose is localized independently.
- Link locale: links to corpus documents use `.md` on the base side and `.en.md` on the English side; the switcher is the only cross-language link.
- Generated regions: segments inside `<!-- BEGIN GENERATED slug -->` are byte-identical across sides except locale path projection.
- The English side obeys the banned alternatives in [terminology.en.md](terminology.en.md).

## Workflow

- Editing the base: apply the minimal matching edit to `.en.md`, then `pnpm record:i18n -- docs/foo.md`.
- New document: write both sides, then `pnpm record:i18n -- <pair>` to create the record; register it in the [docs index](../README.en.md) and the budget manifest first.
- Full re-record: `pnpm record:i18n -- --all` (recording is an act of confirmation; eyeball the diff first).
- Status report: `node scripts/verify-translation-pairing.mjs --list`.

On merge conflicts `.i18n.yaml` is handled by the fail-closed merge driver (registered via `pnpm install-merge-driver`): when both branches re-recorded the pair it stays conflicted — merge the md sides by hand, then re-record.
