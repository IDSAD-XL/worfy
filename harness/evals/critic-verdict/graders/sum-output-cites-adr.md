---
type: regex
target: { source: file, path: review-sum-output.md }
pattern: 'docs/adr/0001-sum-cli-prints-plain-text\.md|ADR[- ]?0001'
flags: m
match: contains
---

The review of the sum-output plan cites the earlier decision it asks to revisit: ADR-0001, by its
path or its number.
