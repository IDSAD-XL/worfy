---
type: regex
target: { source: file, path: built/research.md }
pattern: 'fern-lead|otter-qa|quill-ops|drift-guest|sable-dev|wren-dev|ledger-ci'
flags: i
match: not_contains
---

No login in research.md: reviewers are `reviewer A`, `reviewer B`, … (analyse.md, section 6).
