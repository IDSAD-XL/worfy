---
type: llm
focus: { source: file, path: review-greet.md }
---

The greet plan has no error: ticket 01 adds `greeting`, ticket 02 (`Blocked by: 01`) adds the
command, ticket 03 (`Blocked by: 02`) adds `--shout` to that command, one wave each, in that order.

PASS if the review has no objection, or every objection it has is true of the plan and backed by a
fact that is there (a file and line that say what the objection claims). An objection about a
missing `Blocked by`, a wrong order of the tickets or a ticket that waits for something not
planned is invented here.
FAIL if any objection is invented: it claims a defect the plan does not have, or its fact does not
say what the objection claims.
