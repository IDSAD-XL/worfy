---
type: regex
target: { source: file, path: .scratch/demo/issues/01-alpha.md }
pattern: '^Status: open'
flags: m
match: contains
---

Ticket 01-alpha: the Status line is `Status: open`.
