---
type: regex
target: { source: file, path: .scratch/demo/issues/04-delta.md }
pattern: '^Status: open'
flags: m
match: contains
---

Ticket 04-delta: the Status line is `Status: open`.
