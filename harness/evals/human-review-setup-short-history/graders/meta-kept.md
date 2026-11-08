---
type: regex
target: { source: file, path: private-folder.txt }
pattern: '^meta\.json\r?$'
flags: m
match: contains
---

The private folder keeps `meta.json` with the counts (step 3, item 3).
