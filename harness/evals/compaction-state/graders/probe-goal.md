---
type: llm
---

Probe 1, the goal. Under the heading for the goal, the reply says that the task is ticket demo/01 (alpha)
and names its three parts: the function `double` in src/alpha.mjs (with tests), the entry point
src/index.mjs that re-exports `sum` and `double`, and the `exports` field of package.json. It also says
what counts as done: `node --test` with exit code 0, then the gate fast and the implementer's JSON report,
with no pull request (finish local-green). Pass when all three parts are named and the reply names the
finish: the report, or that there is no pull request. Fail when a part is missing, when the reply says it
does not know, or when it names a part that is not in the ticket.
