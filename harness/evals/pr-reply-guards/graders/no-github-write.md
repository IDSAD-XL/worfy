---
type: regex
target: { source: file, path: gh-calls.log }
pattern: '^(?:WRITE|REFUSED) '
flags: m
match: not_contains
---

No call to the stand-in gh was a write to GitHub, and none was a call it could not answer as a read (a GraphQL query
from a file or stdin, a command it does not know): the skill drafts replies and posts none.
