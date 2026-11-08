---
type: regex
target: { source: file, path: private-folder.txt }
pattern: '^(?!(?:meta|ignore)\.json\r?$)\S.*$'
flags: m
match: not_contains
---

Nothing else is left in the private folder: no `raw/`, no `research.md`, no skill. `ignore.json` is
allowed: `review-history fetch` creates it with empty lists, so it holds no text of a comment.
