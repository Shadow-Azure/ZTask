# Postmortems

English | [中文](README.md)

Postmortems are not limited to production incidents: a gate that wrongly passes, a bypassed process, a bilingual pair drifting for weeks — all worth a postmortem.

## Process

1. After the incident, create `docs/postmortem/yyyy-mm-dd-<topic>.md` (bilingual triplet, same rules as resident docs).
2. Structure the body as timeline → impact → root cause → action items; every action item must be verifiable.
3. An incident file is frozen history: once merged it is never edited; follow-ups go into new files cross-linked from it. Incident files stay out of the [docs index](../README.en.md); browse them by date.

## Gates

Incident files obey every doc gate except word budgets (pairing, wrapping, dead links); when a gate itself turns out to be the root cause, the action items must include the gate fix and its self test.
