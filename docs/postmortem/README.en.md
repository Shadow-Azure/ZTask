# Incident review (postmortem)

English | [中文](README.md)

The only tier where incident records live: the only place narrative is allowed. One numbered file per incident, `NNNN-topic.md`, with a fixed structure:

1. **Executive summary** — one paragraph covering impact and conclusion
2. **Timeline** — timeline with evidence (referencing commits/logs)
3. **Root cause** — the cause, pointing at mechanisms rather than people
4. **Action items** — concrete changes mapped to gates/code/docs

Postmortems are not limited to production incidents: a gate that wrongly passes, a bypassed process, a bilingual pair drifting for weeks — all worth a postmortem.

Mechanical checks (verify-postmortem, always in doc-quick/doc-sync): numbering is contiguous and unique from 0001; the four headings appear verbatim on both sides, in order.

Incident files are frozen history: once merged they are never edited; follow-ups go into new files cross-linked from it. Action items land in the same PR as the write-up; if a new gate is introduced, register it in the gate list in [docs/AGENTS.md](../AGENTS.md).
