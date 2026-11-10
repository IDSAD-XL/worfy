---
type: regex
target: { source: file, path: built/draft.json }
pattern: '"fixPlan"\s*:\s*"[^"]'
match: contains
---

The pull request is the person's own, so the reply labelled "needs code change" carries a fixPlan (step 4).
