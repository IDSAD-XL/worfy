---
type: llm
focus: { source: file, path: review.md }
---

In the reviewed change `csvLine` and `tsvLine` of `src/export.mjs` are two near-copies. The author
marked them with the comment `shortcut: no more than two formats with a copy of the join each, redo
when a third format appears`. The change has two formats, so the condition of the comment is not
met.

PASS if no finding of the review — a line with a severity `[high]`, `[med]` or `[low]` — asks to
merge `csvLine` and `tsvLine`, to extract their common part, or reports the two copies as
duplication. Mentioning the two copies without a severity, or saying that the comment makes them
the author's decision, is fine. A finding about `durationText` that happens to name `csvLine` or
`tsvLine` as its callers is fine too.
FAIL if the two copies are reported as a finding with a severity.
