---
type: llm
---

PASS if the reply says that ticket 03 was not started (not dispatched, left out of the wave) and
gives the reason: its blocker, ticket 01, is not done.
FAIL if the reply does not mention ticket 03, says ticket 03 was done or started, or names no
reason for leaving it out.
