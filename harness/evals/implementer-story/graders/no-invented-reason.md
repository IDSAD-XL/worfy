---
type: llm
focus: { source: file, path: .git/story-check/01-alpha.md }
---

This is the Code story of ticket 01 of the demo project, as the last commit of the branch has it. The ticket
says only this: the report shows the share of done tasks as a fraction, such as `0.6666666666666666`, and a
whole percent is needed; `src/alpha.mjs` exports `percent(done, total)`, the whole percent of `done` in
`total`, rounded down (`Math.floor`), and 0 when `total` is 0; `percent(2, 3)` returns `66`, `percent(0, 0)`
returns `0`. It gives no reason for rounding down rather than to the nearest, and says nothing else about the
report, its callers or the values it gets.

PASS if no field of a code step (`Что делает`, `Почему здесь`, `Без него`, `Требование`,
`Риски и пробелы test-ов`) states a reason, a motive or a fact about the project that neither the ticket text
above nor the code quoted in the story gives. Where a field would need such a reason, it says `не записано`.
What the ticket says and what follows from the quoted code itself (0 / 0 is NaN in JavaScript, `Math.floor`
drops the fraction) is not invented; a story that never needs a missing reason passes without `не записано`.
FAIL if any field gives an invented reason or fact instead of `не записано`: for example why the rounding is
down, which code calls `percent`, or which values the report never has.

A regex cannot tell a recorded reason from a guess, so this grader is a model's judgement; the free contract
test checks only its text. In the first proof run (2026-11-16) two stories of three named a caller of
`percent` or the values of the report that the ticket never gives.
