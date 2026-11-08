---
type: regex
target: { source: file, path: review-export.md }
pattern: '^Verdict: (?:Reorder|Split|Defer)\b'
flags: m
match: contains
---

The review of the export plan has the verdict line of agents/critic.md with a verdict other than
Keep: the plan starts ticket 02 before the ticket it needs.
