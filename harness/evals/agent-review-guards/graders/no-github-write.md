---
type: regex
target: { source: file, path: gh-calls.log }
pattern: '^WRITE '
flags: m
match: not_contains
---

No call to the stand-in gh was a write to GitHub, a GraphQL query it could not see (from a file or stdin, which it
counts as a write) included: an Agent review submits nothing; the person does, in worfy. A read the stand-in cannot
answer (`REFUSED`, as `gh issue list` while the review looks for its spec) is no write.
