---
type: regex
target: { source: file, path: built/draft.json }
pattern: '"label"\s*:\s*"needs code change"'
match: contains
---

The empty-list bug of PRRT_evalA1 is in the head commit, so its reply is labelled "needs code change" (step 4).
