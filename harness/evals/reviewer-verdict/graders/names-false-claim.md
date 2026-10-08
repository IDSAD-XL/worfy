---
type: llm
focus: { source: file, path: verdict.md }
---

PASS if the list of unconfirmed claims includes the claim that `node --test` passes or exits with
code 0, and says it is false (the tests fail, the exit code is not 0).
FAIL if the text does not name that claim, or calls it confirmed.
