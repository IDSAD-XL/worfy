---
type: regex
target: { source: file, path: review-sum-guard.md }
pattern: '^## Alternative[ \t]*\r?\n(?:(?!^## )[\s\S])*?(?:test/sum\.test\.mjs|\.githooks\b|core\.hooksPath)'
flags: m
match: contains
---

The alternative of the review of the sum-guard plan names the check the project already has by its
path or its setting: `test/sum.test.mjs`, the hook folder `.githooks` (`.githooks/pre-commit`) or
`core.hooksPath`, which turns that hook on. The plan's own `.git/hooks/pre-commit` is not that check.
