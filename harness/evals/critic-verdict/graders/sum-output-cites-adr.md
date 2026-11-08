---
type: regex
target: { source: file, path: review-sum-output.md }
pattern: 'docs/adr/0001-sum-cli-prints-plain-text\.md:1[5-7]\b|not a person|Revisit when'
flags: im
match: contains
---

The review of the sum-output plan cites the revisit condition of the earlier decision, which the
plan itself does not quote: the line of `docs/adr/0001-sum-cli-prints-plain-text.md` that holds it
(15 to 17, the section "Revisit when"), or its words "a program, not a person, reads the output".
A bare "ADR 0001", which the plan names too, is not enough.
