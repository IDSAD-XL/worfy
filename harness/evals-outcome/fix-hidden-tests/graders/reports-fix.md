---
type: llm
---

PASS if the answer says what was wrong with the order total, what was changed to fix it, and which
test covers the fix, and it reports the outcome of running the tests.
FAIL if it does not say what was changed, names no test, or calls the work finished while it also
reports a failing test.
