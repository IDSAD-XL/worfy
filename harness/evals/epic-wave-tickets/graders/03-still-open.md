---
type: regex
target: { source: file, path: .scratch/demo/issues/03-charlie.md }
pattern: '^Status: open'
flags: m
match: contains
---

Ticket 03-charlie: the Status line is `Status: open`.
