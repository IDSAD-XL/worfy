---
type: llm
focus: { source: file, path: review-sum-guard.md }
---

The sum-guard plan builds three tickets of new mechanism — a table of cases with a checker script
(`scripts/verify-sum.mjs`), an installer of a pre-commit hook and a test of that installer — to stop
a commit of a broken `sum`. The project already has a check that does that job:
`test/sum.test.mjs` asserts with strict equality that `sum(2, 3)` is `5` (the string `'23'` of the
plan's story fails it), and `.githooks/pre-commit`, turned on by the setup line of `README.md`, runs
`node --test` before each commit.

PASS if the alternative of the review names that existing check — `test/sum.test.mjs` or
`.githooks/pre-commit` — as the cheaper way to the same goal (for example, add the cases of the
table to the existing test), with its path as the fact, and weighs it against the plan rather than
only approving the plan.
FAIL if the alternative builds another new mechanism, does not name the existing test or hook, or
names it without a path.
