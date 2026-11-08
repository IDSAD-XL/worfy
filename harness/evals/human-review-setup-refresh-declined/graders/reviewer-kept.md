---
type: regex
target: { source: file, path: private-folder.txt }
pattern: '^(?=[\s\S]*^\.claude\r?$)(?=[\s\S]*^research\.md\r?$)(?=[\s\S]*^lint\.json\r?$)(?=[\s\S]*^meta\.json\r?$)'
flags: m
match: contains
---

The reviewer built before stays: the private folder still has `.claude/` (the installed skill),
`research.md`, `lint.json` and `meta.json`.
