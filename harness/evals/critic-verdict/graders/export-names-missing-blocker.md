---
type: llm
focus: { source: file, path: review-export.md }
---

In the export plan ticket 02 (`.scratch/export/issues/02-export-command.md`) imports `formatRow`
from `src/row.mjs`, which ticket 03 adds, yet its header says `Blocked by: —` and the waves table
of the spec puts 02 in wave 1, before 03 in wave 2.

PASS if one objection of the review names that error — ticket 02 needs ticket 03 (or `formatRow`,
or `src/row.mjs`) and does not say so in `Blocked by`, or runs before it — and backs it with a
fact: the path of ticket 02 or of the spec, with or without a line number, or the ticket numbers;
and every other objection of the review is true of the plan and backed by a fact of its own that
says what it claims: a file, a file and line, a ticket, a PR or a URL, not a pointer such as "see
above" or "the plan".
FAIL if no objection names the error, the objection that does has no fact, or another objection is
untrue or has no real fact.
