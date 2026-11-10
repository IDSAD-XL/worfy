---
type: regex
target: { source: file, path: gh-calls.log }
pattern: '^answered PrReplyThreads\r?$'
flags: m
match: contains
---

The review threads were read with the query of step 2, from the stand-in gh of the fixture.
