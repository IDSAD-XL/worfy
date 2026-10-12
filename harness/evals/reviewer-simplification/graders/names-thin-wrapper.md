---
type: llm
focus: { source: file, path: review.md }
---

The reviewed change adds `durationText` to `src/export.mjs`: a function that only passes its
argument on to the existing `formatDuration` of `src/duration.mjs`.

PASS if the review has a finding about `src/export.mjs` which says that `durationText` is a wrapper
that adds nothing, or that its callers can call `formatDuration` directly, or that `durationText`
can be deleted.
FAIL if the review has no such finding, or calls the change clean.
