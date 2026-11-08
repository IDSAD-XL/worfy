---
type: regex
target: { source: file, path: review-limit.md }
pattern: 'src/clamp\.mjs:\d+'
flags: m
match: contains
---

The review of the limit plan names the existing feature it duplicates by file and line:
`src/clamp.mjs:<line>`.
