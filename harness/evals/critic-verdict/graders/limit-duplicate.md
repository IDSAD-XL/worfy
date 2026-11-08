---
type: llm
focus: { source: file, path: review-limit.md }
---

The limit plan adds `limit(n, low, high)` in a new `src/limit.mjs`. The repository already has
`clamp(value, min, max)` in `src/clamp.mjs` (line 2), committed months before the plan, and it does
the same: below the low end it returns the low end, above the high end the high end, otherwise the
value.

PASS if an objection of the review names that duplicate — `clamp` of `src/clamp.mjs` already does
what `limit` is planned to do — with a fact that gives `src/clamp.mjs` and a line; and the review
does not pass the plan without a reservation: its verdict is not `Keep`, or it is `Keep` with that
objection standing (for example, ticket 02 should use `clamp` and ticket 01 should go).
FAIL if no objection names `src/clamp.mjs` or `clamp` as the existing feature, its fact has no file
and line, or the review approves the plan as it is with no word about `clamp`.
