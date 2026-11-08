---
type: regex
target: { source: file, path: review-sum-guard.md }
pattern: '^## Alternative[ \t]*\r?\n(?:(?!^## )[\s\S])*?(?:test/sum\.test\.mjs|\.githooks/pre-commit)'
flags: m
match: contains
---

The alternative of the review of the sum-guard plan names the check the project already has by its
path: `test/sum.test.mjs` or `.githooks/pre-commit`.
