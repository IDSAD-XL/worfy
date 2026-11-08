---
type: regex
target: { source: file, path: gh-calls.log }
pattern: '^answered ReviewHistoryPage\r?$'
flags: m
match: contains
---

The new pull requests were read from the stand-in gh of the fixture: its log has the answered page.
