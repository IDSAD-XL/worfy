---
type: regex
target: { source: file, path: .scratch/demo/issues/02-bravo.md }
pattern: '^Status: open'
flags: m
match: not_contains
---

Ticket 02-bravo: the Status line is no longer `Status: open`.
