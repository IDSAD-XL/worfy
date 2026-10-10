---
type: llm
focus: { source: file, path: review.md }
---

PASS if the review has a finding about `src/percent.mjs` which says that `percent` rounds down
(`Math.floor`) instead of rounding to the nearest, or that `percent(2, 3)` returns `66.6` and not
the `66.7` the ticket asks for.
FAIL if the review has no such finding, or calls the change clean.
