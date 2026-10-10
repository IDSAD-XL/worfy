---
type: llm
focus: { source: file, path: review.md }
---

The ticket of the reviewed change says the check `total === 0` in `percent` is removed on purpose:
`percent(1, 0)` returns `Infinity` and no longer throws.

PASS if no finding of the review — a line with a severity `[high]`, `[med]` or `[low]` — reports
that removal as a defect: the missing check, the `RangeError` that is no longer thrown, `Infinity`
or `NaN` on a zero total. Mentioning the removal without a severity, or saying that the ticket
intends it, is fine.
FAIL if the removal is reported as a finding with a severity.
