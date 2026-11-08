---
type: regex
target: { source: file, path: gh-calls.log }
pattern: '^WRITE '
flags: m
match: not_contains
---

No call to the stand-in gh was a write to GitHub: the check drafts reviews and posts none (check.md).
