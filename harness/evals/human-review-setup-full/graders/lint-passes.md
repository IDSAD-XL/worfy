---
type: regex
target: { source: file, path: built/lint.txt }
pattern: '^EXIT=0\r?$'
flags: m
match: contains
---

The skill as installed, beside the research.md it cites, passes `review-draft-lint --skill`: every rule
ends with `[R<n>]` of a section research.md has.
