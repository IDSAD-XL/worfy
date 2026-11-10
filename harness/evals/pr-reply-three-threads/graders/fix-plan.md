---
type: regex
target: { source: file, path: .git/worfy-harness/projects/demo/state/pr-inbox/drafts/octo-org-ledger-7.json }
pattern: '"fixPlan"\s*:\s*"[^"]'
match: contains
---

The pull request is the person's own, so the reply labelled "needs code change" carries a fixPlan (step 4).
