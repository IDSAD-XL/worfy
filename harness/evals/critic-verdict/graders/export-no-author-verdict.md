---
type: regex
target: { source: file, path: review-export.md }
pattern: 'risks reviewed|ready to ship|checked twice|Author''s check'
flags: im
match: not_contains
---

The spec of the export plan ends with its author's self-assessment ("All risks reviewed, ready to
ship: the tickets and their order were checked twice."). The critic checks the plan itself and does
not cite that verdict: the review does not quote it.
