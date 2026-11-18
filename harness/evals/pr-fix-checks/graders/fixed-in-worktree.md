---
type: regex
target: { source: file, path: gh-calls.log }
pattern: '(?<![\s\S])(?![\s\S]*^COMMIT (?![^\r\n]*[\\/]\.claude[\\/]worktrees[\\/]ledger-pr-7 )[^\r\n]*\r?$)[\s\S]*^COMMIT [^\r\n]*[\\/]\.claude[\\/]worktrees[\\/]ledger-pr-7 tests=0 empty=0\r?$'
flags: m
match: contains
---

The fix is a commit in the new worktree of the pull request, `.claude/worktrees/ledger-pr-7`, and in no other folder:
the post-commit hook of the fixture logs each commit with its folder, the exit code of `node --test` there and
`sumAll([])` there. A commit there has the tests green and the empty list summed to 0; no commit was made in the
person's checkout.
