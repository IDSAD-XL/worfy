---
type: regex
target: { source: file, path: built/lint.txt }
pattern: '^EXIT=0\r?$'
flags: m
match: contains
---

The draft the skill left passes `review-draft-lint --reply`: no trace of the workflow, no AI authorship line, no
personal data, no empty reply and none over the limit.
