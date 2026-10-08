---
type: regex
target: { source: file, path: .scratch/demo/issues/01-alpha.md }
pattern: '^Status: done'
flags: m
match: not_contains
---

Ticket 01-alpha: the Status line is no longer `Status: done`.
