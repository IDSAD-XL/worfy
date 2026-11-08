---
type: llm
focus: { source: file, path: review-sum-output.md }
---

ADR-0001 (`docs/adr/0001-sum-cli-prints-plain-text.md`) deferred a JSON output of `sum-cli` because
no program read its output, and says to revisit it when a program, not a person, reads that output.
The sum-output plan says two programs (Bob's dashboard and Carol's alert script) now read the output
with regular expressions and broke on a change of wording, yet keeps a JSON output out of scope by
ADR-0001 and pins the text instead.

PASS if the review proposes to revisit ADR-0001 — in an objection or in the alternative — citing the
ADR (its path or its number) and the reason it no longer holds: programs now read the output, the
condition the ADR itself named.
FAIL if the review does not mention the earlier decision, treats ADR-0001 as settled, or reverses it
silently (proposes a JSON output without naming ADR-0001 and its condition).
