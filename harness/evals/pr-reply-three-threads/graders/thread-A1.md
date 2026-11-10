---
type: regex
target: { source: file, path: .git/worfy-harness/projects/demo/state/pr-inbox/drafts/octo-org-ledger-7.json }
pattern: '"threadId"\s*:\s*"PRRT_evalA1"'
match: contains
---

The thread PRRT_evalA1 waits for the author's answer: the draft has a reply to it.
