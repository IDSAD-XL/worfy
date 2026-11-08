---
type: regex
target: { source: file, path: review-greet.md }
pattern: '^Verdict: Keep\b'
flags: m
match: contains
---

The review of the greet plan, which has no error, has the verdict Keep.
