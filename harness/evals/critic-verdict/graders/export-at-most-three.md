---
type: regex
target: { source: file, path: review-export.md }
pattern: '(?:^### [\s\S]*?){4}'
flags: m
match: not_contains
---

The review of the export plan has at most three objections: no fourth `### ` heading.
