# Agent Note: Member Personal Page Auto-Save and Page-Wide Save

Status: implemented

English | [中文](2026-11-08-member-auto-save.md)

## Problem

The “我负责的” (my tasks) card on the member personal page used to submit progress and the full detail through two separate buttons, “保存进度” and “保存详情”. A user reported being unsure which button to click when only the detail changed, and that the save action could be blocked by a disabled button when progress was unchanged. Two buttons also meant that two kinds of changes on the same card could not be submitted in one action, forcing occasional users to understand two independent write paths. The member-page save interaction follows this decision and the confirmed implementation; the m1-01 prototype also carries other UI iterations.

## Decision

Each owner task card keeps a single “保存” button that submits all changes for that task: it PATCHes progress first, then PATCHes detail with the new version returned by the progress response. The two endpoints remain independent, but the frontend submits them serially so the same aggregate version is never written concurrently. After editing stops for 2 seconds, the same drafts are auto-saved. An inline status shows “等待自动保存 / 正在保存 / 已保存 / 失败” plus the save time. On success the response is written back into the share-home cache, so the card advances to the new version immediately. The member home page listens for Ctrl/⌘+S, calls each owner card's save, and reports the page-level result. A 409 still preserves drafts and shows “放弃草稿并刷新”.

## Alternatives considered

Keeping two save buttons was rejected: it forces users to decide which write path applies, which is the source of this report. Auto-save alone was rejected: users still need a deterministic immediate action, so the per-card “保存” and page-wide Ctrl+S remain. Merging the two endpoints into a new atomic backend API was rejected: that would widen the API and revision-semantics change; serial frontend submission already saves all changes in one action. Saving on detail blur was rejected: idle-time auto-save behaves consistently for both keyboard and slider input. Auto-save does append a detail snapshot on each idle save; a 2-second debounce and re-arming when input continues during a save limit the frequency, without backend snapshot coalescing.

## Consequences

- The member card now has one explicit save button that submits progress and detail together; Ctrl+S saves the whole page.
- Auto-save clears its timer on unmount; a failed save is not retried automatically and waits for the next input or manual save.
- Conflict handling keeps the existing 409 draft-preservation and refresh prompt; the subtask editor keeps its own save button, and Ctrl+S does not submit an unconfirmed subtask form.
- Tests cover progress-only, detail-only, serial progress+detail versions, 2-second auto-save, Ctrl+S page save, and the 409 conflict.
