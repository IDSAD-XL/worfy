---
type: regex
target: { source: file, path: built/state.txt }
pattern: '^worktree=ledger-pr-7 ahead=yes clean=yes tests=0 empty=0 checkout=untouched\r?$'
flags: m
match: contains
---

The fix is committed in the new worktree of the pull request, `.claude/worktrees/ledger-pr-7`, and not in the
person's checkout: `.git/eval-gh/state.cjs`, which the prompt runs at the end, finds its HEAD after the head of the pull
request, nothing uncommitted there, `node --test` green and `sumAll([])` 0 there, and the person's checkout on main at
the commit the fixture left, no tracked file changed. A commit in a third folder is not looked at.
